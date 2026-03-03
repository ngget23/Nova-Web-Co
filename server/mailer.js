import nodemailer from "nodemailer";

export function makeTransporter(env) {
    return nodemailer.createTransport({
    host: env.EMAIL_HOST,
    port: Number(env.EMAIL_PORT),
    secure: String(env.EMAIL_SECURE).toLowerCase() === "true",
    auth: {
        user: env.EMAIL_USER,
        pass: env.EMAIL_PASS
    }
    });
}

export async function sendOrderEmail({ transporter, to, subject, html }) {
    await transporter.sendMail({
    from: `"Website Orders" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html
    });
}