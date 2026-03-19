import nodemailer from 'nodemailer';

// Use a simple test account or configure your real SMTP credentials via .env
// For development, we'll try to use a real SMTP service if configured in .env,
// otherwise we will mock it or fail gracefully.
const transporter = nodemailer.createTransport({
  service: 'gmail', // Standard configuration for Gmail
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS, // Use app password if using Gmail
  },
});

export async function sendTicketEmail(booking, event, qrCodeDataURL) {
  try {
    // Check if email credentials exist; if not, just log a warning and return.
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.warn('EMAIL_USER and EMAIL_PASS not set in .env. Skipping actual email send.');
      console.warn(`Simulated Email Sent to: ${booking.attendeeEmail} for booking ${booking.id}`);
      return false;
    }

    const eventDate = new Date(event.date).toLocaleDateString(undefined, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const mailOptions = {
      from: `"GateOn Tickets" <${process.env.EMAIL_USER}>`,
      to: booking.attendeeEmail,
      subject: `Your Ticket for ${event.title} is Confirmed! 🎉`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; background-color: #f8fafc;">
          <h2 style="color: #0f172a; text-align: center;">You're going to ${event.title}!</h2>
          <p style="color: #475569; font-size: 16px;">Hi ${booking.attendeeName},</p>
          <p style="color: #475569; font-size: 16px;">Your booking is confirmed. Here are your event details:</p>
          
          <div style="background-color: white; padding: 20px; border-radius: 8px; border: 1px solid #e2e8f0; margin-top: 20px; margin-bottom: 20px;">
            <p style="margin: 0 0 10px 0;"><strong>📅 Date:</strong> ${eventDate}</p>
            <p style="margin: 0 0 10px 0;"><strong>📍 Location:</strong> ${event.location || event.venue || 'TBA'}</p>
            <p style="margin: 0 0 10px 0;"><strong>🎟️ Ticket Type:</strong> ${booking.quantity}x Access</p>
            <p style="margin: 0;"><strong>🆔 Booking ID:</strong> ${booking.id}</p>
          </div>

          <div style="text-align: center; margin-top: 30px;">
            <p style="color: #0f172a; font-weight: bold; margin-bottom: 10px;">Your Entry Ticket (QR Code)</p>
            <p style="color: #64748b; font-size: 14px; margin-bottom: 20px;">Please show this QR code at the entrance to check in.</p>
            <img src="cid:ticket_qr_code" alt="Ticket QR Code" style="width: 250px; height: 250px; border: 4px solid white; border-radius: 12px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);" />
            <p style="font-family: monospace; font-size: 16px; margin-top: 15px; letter-spacing: 2px;">${booking.ticketCode}</p>
          </div>

          <p style="color: #475569; font-size: 14px; text-align: center; margin-top: 40px;">
            Thank you for using GateOn! Have a great time at the event.
          </p>
        </div>
      `,
      attachments: [
        {
          filename: 'ticket-qr.png',
          // Data URIs look like: data:image/png;base64,iVBORw0KGgo...
          path: qrCodeDataURL,
          cid: 'ticket_qr_code' // same cid value as in the html img src
        }
      ]
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Ticket email sent successfully:', info.messageId);
    return true;
  } catch (error) {
    console.error('Error sending ticket email:', error);
    return false;
  }
}
