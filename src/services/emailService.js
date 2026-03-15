const nodemailer = require('nodemailer');
const path = require('path');
const gcs = require('../config/gcs');

class EmailService {
  constructor() {
    this.transporter = null;

    // F2: Bruk sentralisert GCS-konfigurasjon
    this.bucket = gcs.bucket;
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

  /** D11: Sikre at transporter er initialisert før sending */
  async ensureInit() {
    if (!this.transporter) {
      await this.init();
    }
  }

  async sendServiceReport(reportId, tenantId) {
    await this.ensureInit();
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
      
      // Hent rapport-mottaker fra lokal customer_contacts (via Tripletex external_id)
      const customerService = require('./customerService');
      const recipient = await customerService.getReportRecipientByExternalId(tenantId, report.customer_id);
      const customerEmail = recipient?.email;

      if (!customerEmail) {
          throw new Error('Ingen rapport-mottaker funnet for kunde');
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
      
      // Hent PDF fra GCS via bucket API
      const gcsPath = `tenants/${tenantId}/${report.pdf_path}`;
      console.log(`📥 Fetching PDF from GCS: ${gcsPath} (bucket: ${gcs.bucketName})`);
      let attachmentOptions;

      try {
        const file = this.bucket.file(gcsPath);
        const [pdfBuffer] = await file.download();
        console.log(`✅ PDF downloaded from GCS (${Math.round(pdfBuffer.length / 1024)}KB)`);
        attachmentOptions = {
          filename: `servicerapport_${reportId}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf'
        };
      } catch (downloadError) {
        console.error(`❌ GCS download failed for path: ${gcsPath}`, downloadError.message);
        throw new Error(`Kunne ikke hente PDF fra GCS: ${downloadError.message}`);
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
    await this.ensureInit();
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
        
        // Hent samme data som PDF bruker
        const hours = parseFloat(items.estimatedHours) || 0;
        const products = items.products || [];
        const arbeidsBelop = parseFloat(quote.total_amount) || 0;
        const materialCost = products.reduce((sum, product) => {
            return sum + (parseFloat(product.quantity || 1) * parseFloat(product.price || 0));
        }, 0);
        const totalEksMva = arbeidsBelop + materialCost;
        const mvaAmount = totalEksMva * 0.25;
        const totalInklMva = totalEksMva + mvaAmount;

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
                    <h3>Tilbudssammendrag</h3>
                    <table style="border-collapse: collapse; width: 100%; font-family: Arial, sans-serif;">
                        <thead>
                            <tr style="background-color: #f2f2f2;">
                                <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Beskrivelse</th>
                                <th style="border: 1px solid #ddd; padding: 8px; text-align: right;">Pris</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${hours > 0 ? `
                                <tr>
                                    <td style="border: 1px solid #ddd; padding: 8px;">Arbeidskostnad, ${hours} timer</td>
                                    <td style="border: 1px solid #ddd; padding: 8px; text-align: right;">${arbeidsBelop.toLocaleString('nb-NO')} kr</td>
                                </tr>
                            ` : ''}
                            
                            ${products.length > 0 ? `
                                <tr>
                                    <td style="border: 1px solid #ddd; padding: 8px;"><strong>Materialer</strong></td>
                                    <td style="border: 1px solid #ddd; padding: 8px; text-align: right;"><strong>${materialCost.toLocaleString('nb-NO')} kr</strong></td>
                                </tr>
                                ${products.map(product => `
                                    <tr>
                                        <td style="border: 1px solid #ddd; padding: 8px; padding-left: 20px;">• ${product.name} (${product.quantity} stk)</td>
                                        <td style="border: 1px solid #ddd; padding: 8px; text-align: right;">${(product.quantity * product.price).toLocaleString('nb-NO')} kr</td>
                                    </tr>
                                `).join('')}
                            ` : ''}
                        </tbody>
                        <tfoot>
                            <tr style="background-color: #f9f9f9; font-weight: bold;">
                                <td style="border: 1px solid #ddd; padding: 8px;">Totalt eks. MVA</td>
                                <td style="border: 1px solid #ddd; padding: 8px; text-align: right;">${totalEksMva.toLocaleString('nb-NO')} kr</td>
                            </tr>
                            <tr style="background-color: #f9f9f9; font-weight: bold;">
                                <td style="border: 1px solid #ddd; padding: 8px;">MVA (25%)</td>
                                <td style="border: 1px solid #ddd; padding: 8px; text-align: right;">${mvaAmount.toLocaleString('nb-NO')} kr</td>
                            </tr>
                            <tr style="background-color: #f9f9f9; font-weight: bold;">
                                <td style="border: 1px solid #ddd; padding: 8px;">Totalt inkl. MVA</td>
                                <td style="border: 1px solid #ddd; padding: 8px; text-align: right;">${totalInklMva.toLocaleString('nb-NO')} kr</td>
                            </tr>
                        </tfoot>
                    </table>
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
async sendOrderReportsToCustomer(orderId, tenantId, reports, customerEmail, order) {
  await this.ensureInit();
  try {
    console.log(`📧 Sending report for order ${orderId} to ${customerEmail}`);
    
    // Hent from-adresse fra settings
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
    
    // ENDRING: Kun bruk FØRSTE rapport siden alle peker til samme PDF
    const firstReport = reports[0];
    
    if (!firstReport || !firstReport.pdf_path || !firstReport.pdf_generated) {
      throw new Error('Ingen PDF funnet for denne ordren');
    }
    
    // Hent PDF fra GCS via bucket API (autentisert, fungerer uansett om bucket er public eller ikke)
    const gcsPath = `tenants/${tenantId}/${firstReport.pdf_path}`;
    console.log(`📥 Fetching PDF from GCS: ${gcsPath} (bucket: ${gcs.bucketName})`);

    let pdfBuffer;
    try {
      const file = gcs.bucket.file(gcsPath);
      [pdfBuffer] = await file.download();
      console.log(`✅ PDF downloaded from GCS: ${Math.round(pdfBuffer.length / 1024)}KB`);
    } catch (error) {
      console.error(`❌ GCS download failed for path: ${gcsPath}`, error.message);
      throw new Error(`Kunne ikke hente PDF fra GCS: ${error.message}`);
    }
    
    // Bygg e-post innhold med liste over alle anlegg
    const equipmentList = reports
      .map(r => `- ${r.systemnavn || r.systemtype}`)
      .join('\n');
    
    const mailOptions = {
      from: fromEmail,
      to: customerEmail,
      subject: `Servicerapport - Ordre ${orderId} - ${order.customer_name}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1e40af;">Servicerapport</h2>
          <p>Hei,</p>
          <p>Vedlagt finner du servicerapport(er) for utført service hos ${order.customer_name}.</p>
          
          <div style="background-color: #f3f4f6; padding: 16px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0;"><strong>Ordre:</strong> ${orderId}</p>
            <p style="margin: 8px 0 0 0;"><strong>Dato:</strong> ${new Date(order.scheduled_date).toLocaleDateString('nb-NO')}</p>
            <p style="margin: 8px 0 0 0;"><strong>Antall anlegg:</strong> ${reports.length}</p>
          </div>
          
          <p><strong>Servicerte anlegg:</strong></p>
          <pre style="background-color: #f9fafb; padding: 12px; border-radius: 4px;">${equipmentList}</pre>
          
          <p>Ta gjerne kontakt dersom du har spørsmål.</p>
          
          <p style="margin-top: 32px;">
            Med vennlig hilsen,<br>
            <strong>Air-Tech AS</strong>
          </p>
        </div>
      `,
      attachments: [{
        filename: `Servicerapport_${orderId}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf'
      }]
    };
    
    const result = await this.transporter.sendMail(mailOptions);
    
    return {
      success: true,
      messageId: result.messageId,
      sentTo: customerEmail,
      fromEmail: fromEmail,
      reportCount: 1  // Alltid 1 PDF nå
    };
    
  } catch (error) {
    console.error('Email sending error:', error);
    throw error;
  }
}
}

module.exports = new EmailService();