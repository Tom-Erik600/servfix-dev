const nodemailer = require('nodemailer');
const tripletexService = require('./tripletexService');
const path = require('path');

class EmailService {
  constructor() {
    this.transporter = null;
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
      
      // NYTT: Hent from-adresse fra lagrede innstillinger
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
      
      // Sjekk om PDF finnes
      const pdfPath = path.join(__dirname, '../servfix-files/tenants', tenantId, report.pdf_path);
      
      try {
        await require('fs').promises.access(pdfPath);
      } catch (error) {
        throw new Error('PDF-fil ikke funnet');
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
        attachments: [{
          filename: `servicerapport_${reportId}.pdf`,
          path: pdfPath
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
      console.error('Email sending error:', error);
      throw error;
    }
  }
}

module.exports = new EmailService();
