const nodemailer = require('nodemailer');
const tripletexService = require('./tripletexService');
const path = require('path');
const { Storage } = require('@google-cloud/storage');

class EmailService {
  constructor() {
    this.transporter = null;
    
    // Google Cloud Storage setup
    this.storage = new Storage({
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
      keyFilename: process.env.GOOGLE_CLOUD_KEY_FILE,
    });
    this.bucket = this.storage.bucket(process.env.GCS_BUCKET_NAME || 'servfix-files');
  }

  async init() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: process.env.SMTP_PORT || 587,
      secure: false, // true for 465, false for andre porter
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
    
    // Test tilkobling
    console.log('🔧 Testing email connection...');
    await this.transporter.verify();
    console.log('✅ Email service ready');
  }

  async sendServiceReport(reportId, tenantId) {
    try {
      const db = require('../config/database');
      const pool = await db.getTenantConnection(tenantId);
      
      const reportQuery = `
        SELECT sr.*, o.customer_id, o.customer_name, o.scheduled_date
        FROM service_reports sr
        JOIN orders o ON sr.order_id = o.id
        WHERE sr.id = $1
      `;
      
      const reportResult = await pool.query(reportQuery, [reportId]);
      if (reportResult.rows.length === 0) {
        throw new Error('Rapport ikke funnet');
      }
      
      const report = reportResult.rows[0];
      
      // Hent servfixmail-kontaktens e-post fra Tripletex
      const servfixContact = await tripletexService.getServfixmailContact(report.customer_id);
      const customerEmail = servfixContact?.email;

      if (!customerEmail) {
          throw new Error('Ingen servfixmail-kontakt funnet for kunde');
      }
      
      // Hent from-adresse fra lagrede innstillinger
      let fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER;
      try {
        const settingsResponse = await fetch(`http://localhost:${process.env.PORT || 3000}/api/images/settings`);
        if (settingsResponse.ok) {
          const settings = await settingsResponse.json();
          fromEmail = settings.reportSettings?.senderEmail || fromEmail;
          console.log(`📧 Using sender email from settings: ${fromEmail}`);
        }
      } catch (error) {
        console.warn('Could not load sender email from settings, using default:', error.message);
      }
      
      // Hent PDF - eksakt samme tilnærming som admin/reports.js
      let attachmentOptions;
      
      // Bygg GCS path og public URL (samme som admin/reports.js)
      const bucketName = process.env.GCS_BUCKET_NAME || 'servfix-files';
      const gcsPath = `tenants/${tenantId}/${report.pdf_path}`;
      const publicUrl = `https://storage.googleapis.com/${bucketName}/${gcsPath}`;
      
      console.log(`📥 Fetching PDF for email attachment:`);
      console.log(`  Report ID: ${reportId}`);
      console.log(`  GCS Path: ${gcsPath}`);
      console.log(`  Public URL: ${publicUrl}`);
      
      try {
        // Prøv å laste ned PDF fra GCS
        const file = this.bucket.file(gcsPath);
        const [pdfBuffer] = await file.download();
        
        console.log(`✅ PDF downloaded from GCS (${Math.round(pdfBuffer.length / 1024)}KB)`);
        
        // Bruk buffer for attachment
        attachmentOptions = {
          filename: `servicerapport_${reportId}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf'
        };
        
      } catch (downloadError) {
        console.warn('⚠️ Could not download PDF from GCS, using public URL:', downloadError.message);
        
        // Fallback: Bruk public URL direkte
        // Nodemailer kan hente fra URL hvis bucket er public
        attachmentOptions = {
          filename: `servicerapport_${reportId}.pdf`,
          path: publicUrl
        };
      }
      
      // Send e-post
      const mailOptions = {
        from: fromEmail,
        to: customerEmail,
        subject: `Servicerapport - ${report.customer_name}`,
        html: `
          <h2>Servicerapport</h2>
          <p>Hei,</p>
          <p>Vedlagt finner du servicerapport for utført arbeid hos ${report.customer_name}.</p>
          <p>Servicedato: ${new Date(report.scheduled_date).toLocaleDateString('no-NO')}</p>
          <p>Med vennlig hilsen,<br>Air-Tech AS</p>
        `,
        attachments: [attachmentOptions]
      };
      
      console.log(`📧 Sending email from ${fromEmail} to ${customerEmail}`);
      const result = await this.transporter.sendMail(mailOptions);
      
      // Oppdater rapport status når e-post er sendt
      await pool.query(
        'UPDATE service_reports SET sent_til_fakturering = true, pdf_sent_timestamp = NOW() WHERE id = $1',
        [reportId]
      );
      
      return {
        success: true,
        messageId: result.messageId,
        sentTo: customerEmail,
        fromEmail: fromEmail
      };
      
    } catch (error) {
      console.error('Email sending error:', error);
      throw error;
    }
  }
  async sendQuoteToCustomer(quoteId, tenantId, pdfBuffer, customerEmail, quote) {
    try {
        console.log(`📧 Preparing email for quote ${quoteId} to ${customerEmail}`);
        
        // Hent settings for fra-adresse
        let fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER;
        try {
            const settingsResponse = await fetch(`http://localhost:${process.env.PORT || 3000}/api/images/settings`);
            if (settingsResponse.ok) {
                const settings = await settingsResponse.json();
                fromEmail = settings.reportSettings?.senderEmail || fromEmail;
            }
        } catch (error) {
            console.warn('Could not load sender email, using default:', error.message);
        }
        
        // Parse quote items for email content
        let items = {};
        try {
            items = typeof quote.items === 'string' ? JSON.parse(quote.items) : (quote.items || {});
        } catch (e) {
            items = {};
        }
        
        const products = items.products || [];
        const hours = parseFloat(items.estimatedHours) || 0;
        
        // RIKTIG BEREGNING basert på din forklaring:
        // 1. Timepris = total_amount fra database (allerede beregnet)
        const timePris = parseFloat(quote.total_amount) || 0;
        
        // 2. Materialpris = sum av alle produkter
        const materialPris = products.reduce((sum, product) => {
            return sum + ((parseFloat(product.quantity) || 1) * (parseFloat(product.price) || 0));
        }, 0);
        
        // 3. Totalpris eks. mva = timepris + materialpris
        const totalEksMva = timePris + materialPris;
        
        // 4. MVA = 25%
        const mvaAmount = totalEksMva * 0.25;
        
        // 5. Totalt inkl. mva
        const totalInklMva = totalEksMva + mvaAmount;
        
        console.log(`📧 Price calculation:`, {
            hours,
            timePris,
            materialPris,
            totalEksMva,
            mvaAmount,
            totalInklMva
        });
        
        // Email innhold med korrekt formatering
        const mailOptions = {
            from: fromEmail,
            to: customerEmail,
            subject: `Tilbud fra Air-Tech AS - ${quote.customer_name}`,
            html: `
                <h2>Tilbud fra Air-Tech AS</h2>
                <p>Hei,</p>
                <p>Vedlagt finner du tilbud for serviceoppdrag.</p>
                
                <div style="background: #f8f9fa; padding: 15px; margin: 20px 0; border-radius: 5px;">
                    <h3>Tilbudssammendrag:</h3>
                    <p><strong>Kunde:</strong> ${quote.customer_name}</p>
                    <p><strong>Beskrivelse:</strong> ${items.description || 'Serviceoppdrag'}</p>
                    ${hours > 0 ? `<p><strong>Estimerte timer:</strong> ${hours} = ${timePris.toLocaleString('nb-NO')} kr</p>` : ''}
                    ${materialPris > 0 ? `<p><strong>Materialer:</strong> ${materialPris.toLocaleString('nb-NO')} kr</p>` : ''}
                    <p style="background: #e7f3ff; padding: 8px; border-radius: 3px; margin-top: 10px;"><strong>Totalt inkl. mva: ${totalInklMva.toLocaleString('nb-NO')} kr</strong></p>
                </div>
                
                <p>Dette tilbudet er gyldig i 30 dager fra dagens dato.</p>
                <p>Ta gjerne kontakt dersom du har spørsmål.</p>
                
                <p>Med vennlig hilsen,<br>
                <strong>Air-Tech AS</strong><br>
                post@air-tech.no<br>
                +47 22 00 00 00</p>
            `,
            attachments: [{
                filename: `tilbud_${quoteId}.pdf`,
                content: pdfBuffer,
                contentType: 'application/pdf'
            }]
        };
        
        console.log(`📧 Sending email from ${fromEmail} to ${customerEmail}`);
        const result = await this.transporter.sendMail(mailOptions);
        
        return {
            success: true,
            messageId: result.messageId,
            sentTo: customerEmail,
            fromEmail: fromEmail
        };
        
    } catch (error) {
        console.error('📧 Email sending error:', error);
        throw error;
    }
}
}

module.exports = new EmailService();