const express = require('express');
const dotenv = require('dotenv');
const nodemailer = require('nodemailer');
const Mailgen = require('mailgen');
const { z } = require('zod');

// 1. Initialize Configuration & Express App
dotenv.config();
const app = express();
app.use(express.json());

// ==========================================
// 2. ERROR BOUNDARY & UTILITIES
// ==========================================

// Custom Error Class
class AppError extends Error {
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
        this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
        this.isOperational = true;
        Error.captureStackTrace(this, this.constructor);
    }
}

// Async Handler to catch Promise rejections and pass to the Error Boundary
const asyncHandler = (fn) => {
    return (req, res, next) => {
        fn(req, res, next).catch(next);
    };
};

// Global Error Handler Middleware
const errorHandler = (err, req, res, next) => {
    err.statusCode = err.statusCode || 500;
    err.status = err.status || 'error';

    res.status(err.statusCode).json({
        status: err.status,
        message: err.message,
        ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
    });
};

// ==========================================
// 3. VALIDATION LAYER
// ==========================================

// Zod Schema for Payload Validation
const emailPayloadSchema = z.object({
    body: z.object({
        name: z.string({ required_error: 'Name is required' }).min(2),
        message: z.string({ required_error: 'Message is required' }).min(5),
        location: z.object({
            latitude: z.number({ required_error: 'Latitude is required' })
                .min(-90).max(90),
            longitude: z.number({ required_error: 'Longitude is required' })
                .min(-180).max(180)
        }, { required_error: 'Location is required' })
    })
});

// Validation Middleware
const validateRequest = (schema) => {
    return (req, res, next) => {
        const result = schema.safeParse({ body: req.body });

        if (!result.success) {
            const message = result.error.issues
                .map((issue) => `${issue.path.slice(1).join('.') || 'body'}: ${issue.message}`)
                .join(', ');
            return next(new AppError(message, 400));
        }

        req.body = result.data.body;
        next();
    };
};

// ==========================================
// 4. SERVICE LAYER (Nodemailer + Mailgen)
// ==========================================

const processAndSendEmail = async ({ name, message, location, alert_type }) => {
    try {
        const smtpPort = Number(process.env.SMTP_PORT || 587);
        const smtpUser = process.env.SMTP_USER;
        const smtpPass = process.env.SMTP_PASS;

        if (!smtpUser || !smtpPass) {
            throw new AppError('SMTP_USER and SMTP_PASS must be configured.', 500);
        }

        // Configure Nodemailer Transport
        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.gmail.com',
            port: smtpPort,
            // Gmail uses implicit TLS on 465 and STARTTLS on 587.
            secure: smtpPort === 465,
            auth: {
                user: smtpUser,
                pass: smtpPass
            }
        });

        // Configure Mailgen
        const mailGenerator = new Mailgen({
            theme: 'default',
            product: {
                name: 'System Notifications',
                link: 'https://your-website.com'
            }
        });

        // Construct Google Static Maps URL
        // 1. Create a direct Google Maps link (No API Key needed)
        const mapUrl = `https://www.google.com/maps?q=${location.latitude},${location.longitude}`;

        // 2. Update your emailBody
        const emailBody = {
            body: {
                name: name,
                intro: 'You have received a new localized message from your application.',
                dictionary: {
                    'Sender Name': name,
                    'Message': message,
                    'Coordinates': `Latitude: ${location.latitude}, Longitude: ${location.longitude}`
                },
                outro: `
            <p><strong>Sender Location:</strong></p>
            <p><strong style='color:red'>Information Type ${alert_type || "Fire emergency"}:</strong></p>
            <a href="${mapUrl}" style="display: inline-block; padding: 10px 20px; background-color: #007BFF; color: #ffffff; text-decoration: none; border-radius: 5px;">📍 View on Google Maps</a>
        `
            }
        };

        const emailBodyHtml = mailGenerator.generate(emailBody);
        const emailBodyText = mailGenerator.generatePlaintext(emailBody);

        // Send Email
        const mailOptions = {
            from: `"Notification system of Fire system" <${smtpUser}>`,
            to: "raj7126770@gmail.com", // Sending to yourself/admin raj7126770@gmail.com
            subject: `New Location-based Message from ${name}`,
            text: emailBodyText,
            html: emailBodyHtml
        };

        const info = await transporter.sendMail(mailOptions);
        return { messageId: info };
    } catch (error) {
        throw new AppError(`Email Service Failed: ${error.message}`, 500);
    }
};

// ==========================================
// 5. ROUTES & CONTROLLERS
// ==========================================

app.post('/email_sender_service',
    validateRequest(emailPayloadSchema),
    asyncHandler(async (req, res, next) => {
        const { name, message, location, alert_type } = req.body;

        const result = await processAndSendEmail({ name, message, location, alert_type });

        res.status(200).json({
            status: 'success',
            message: 'Email successfully generated and sent!',
            data: result
        });
    })
);

// ==========================================
// 6. FALLBACK ROUTES & ERROR MOUNTING
// ==========================================

// Express 5 requires a name for wildcard parameters. Do not use '*' or '\\*'.
app.all('/{*path}', (req, res, next) => {
    next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

// Mount the Global Error Handler
app.use(errorHandler);

// ==========================================
// 7. START SERVER
// ==========================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
