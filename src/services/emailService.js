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
      
      // Hent kundens faktiske e-post fra Tripletex
      const customerDetails = await tripletexService.getCustomer(report.customer_id);
      const customerEmail = customerDetails?.email || customerDetails?.invoiceEmail;
      
      if (!customerEmail) {
        throw new Error('Ingen e-postadresse funnet for kunde');
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
}

module.exports = new EmailService();