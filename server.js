// server.js (Fixed amounts, column alignment, and total calculation)
import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import nodemailer from 'nodemailer';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient, ServerApiVersion } from 'mongodb';
import PDFDocument from 'pdfkit';
import { v2 as cloudinary } from 'cloudinary';
import cors from 'cors';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = "NexonTutoringDB";
const STUDENT_COLLECTION = "students";
const SESSION_COLLECTION = "sessions";
const INVOICES_DIR = path.join(__dirname, 'invoices');

const RATE_GROUP = 230;
const RATE_INDIVIDUAL = 360;

let db;

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const app = express();
const upload = multer({ dest: 'uploads/' });
// Remove any app.use(express.static...) or res.sendFile lines
// Use this CORS setup:
app.use(cors({
    origin: ['https://nexonoperations.github.io',"http://localhost:3000"],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));
app.use(express.static(path.resolve(__dirname)));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  tls: {
    rejectUnauthorized: false
  },
  connectionTimeout: 10000,
  greetingTimeout: 10000
});

transporter.verify((error, success) => {
  if (error) {
    console.error("❌ SMTP VERIFY FAILED:", error);
  } else {
    console.log("✅ SMTP connection ready");
  }
});


// ====================
// Cloudinary Upload
// ====================
async function uploadFileToCloudinary(filePath, fileName) {
    try {
        const result = await cloudinary.uploader.upload(filePath, {
            resource_type: "raw",
            public_id: `invoices/${fileName.replace('.pdf', '')}`
        });
        return result.secure_url;
    } catch (err) {
        console.error("Cloudinary Upload Error:", err);
        throw new Error(`Failed to upload file to Cloudinary: ${err.message}`);
    }
}

// ====================
// Invoice Calculation
// ====================
function calculateInvoiceData(student, sessions) {
    // Only valid sessions
    const validSessions = sessions.filter(s => s.hours && parseFloat(s.hours) > 0);

    let totalHours = 0;
    let totalCost = 0;

    validSessions.forEach(s => {
        const hours = parseFloat(s.hours);
        const rate = (s.mode || '').toLowerCase() === 'individual' ? RATE_INDIVIDUAL : RATE_GROUP;
        totalHours += hours;
        totalCost += hours * rate;
    });

    return { totalHours, totalCost, sessions: validSessions };
}

// ====================
// PDF Generation
// ====================
// --- PDF Generation ---
function generateInvoicePDFStream(student, sessions, filePath) {
    return new Promise((resolve, reject) => {
        const { totalHours, totalCost, sessions: validSessions } =
            calculateInvoiceData(student, sessions);

        const doc = new PDFDocument({ margin: 50 });
        const writeStream = createWriteStream(filePath);
        doc.pipe(writeStream);

        const pageMargin = 50;
        const column1X = pageMargin;
        const column2X = 100;
        const columnPerUurX = 400;
        const columnBedragX = 480;
        const contentWidth = 512;

        let currentY = 50;

        doc.font('Helvetica-Bold').fontSize(10)
            .text('Marissa Engelbrecht', column1X, currentY);
        currentY += 12;

        doc.font('Helvetica').fontSize(10)
            .text('076 481 8803', column1X, currentY);
        currentY += 12;

        doc.text('marissa.ekstraklas@gmail.com', column1X, currentY);
        currentY += 12;

        doc.text('Pierre van Ryneveld', column1X, currentY);

        doc.font('Helvetica-Bold').fontSize(10)
            .text('Bankbesonderhede:', columnPerUurX, 50, {
                width: columnBedragX - columnPerUurX + 50
            });

        doc.font('Helvetica').fontSize(9);
        doc.text('M. Engelbrecht', columnPerUurX, 62, {
            width: columnBedragX - columnPerUurX + 50
        });
        doc.text('FNB', columnPerUurX, 74, {
            width: columnBedragX - columnPerUurX + 50
        });
        doc.text('Takkode: 250655', columnPerUurX, 86, {
            width: columnBedragX - columnPerUurX + 50
        });
        doc.text('Rekening nr: 62507172120', columnPerUurX, 98, {
            width: columnBedragX - columnPerUurX + 50
        });
        doc.text('Spaarrekening', columnPerUurX, 110, {
            width: columnBedragX - columnPerUurX + 50
        });

        currentY = Math.max(currentY, 122);
        doc.y = currentY;
        doc.moveDown(2);

        const invoiceDate = new Date().toLocaleDateString('af-ZA');

        doc.font('Helvetica-Bold').fontSize(24)
            .text('Faktuur', pageMargin, doc.y, {
                width: contentWidth,
                align: 'center'
            });

        doc.moveDown(1.5);

        currentY = doc.y;
        doc.font('Helvetica-Bold').fontSize(10)
            .text('Faktuur vir:', column1X, currentY);
        doc.font('Helvetica').fontSize(10)
            .text(student.name, column1X + 60, currentY);

        doc.font('Helvetica-Bold').fontSize(10)
            .text('Graad:', column1X, currentY + 12);
        doc.font('Helvetica').fontSize(10)
            .text(String(student.grade), column1X + 60, currentY + 12);

        doc.font('Helvetica-Bold').fontSize(10)
            .text('Datum:', columnBedragX - 80, currentY, {
                width: 50,
                align: 'right'
            });
        doc.font('Helvetica').fontSize(10)
            .text(invoiceDate, columnBedragX, currentY, {
                width: 80,
                align: 'right'
            });

        doc.moveDown(2);

        // ===== TABLE HEADER =====
        const tableTop = doc.y;
        doc.font('Helvetica-Bold').fontSize(10);

        doc.text('Ure', column1X, tableTop, { width: 40 });
        doc.text('Beskrywing', column2X, tableTop, { width: 280 });
        doc.text('per uur', columnPerUurX, tableTop, { width: 70, align: 'right' });
        doc.text('Bedrag', columnBedragX, tableTop, { width: 70, align: 'right' });

        doc.moveDown(0.5);
        doc.lineWidth(0.5)
            .moveTo(pageMargin, doc.y)
            .lineTo(pageMargin + contentWidth, doc.y)
            .stroke();
        doc.moveDown(0.5);

        // ===== TABLE ROWS =====
        doc.font('Helvetica').fontSize(9);

        validSessions.forEach(session => {
            const hours = parseFloat(session.hours) || 0;
            const rate =
                (session.mode || '').toLowerCase() === 'individual'
                    ? RATE_INDIVIDUAL
                    : RATE_GROUP;

            const amount = hours * rate;
            const modeText =
                (session.mode || '').toLowerCase() === 'individual'
                    ? 'Individueel'
                    : 'Groep';

            const date = new Date(session.datetime)
                .toLocaleDateString('af-ZA');

            const y = doc.y;

            doc.text(hours.toFixed(1), column1X, y, { width: 40 });

            doc.text(session.subject || '', column2X, y, { width: 85 });
            doc.text(modeText, column2X + 90, y, { width: 65 });
            doc.text(date, column2X + 160, y, { width: 115 });

            doc.text(`R ${rate.toFixed(2)}`, columnPerUurX, y, {
                width: 70,
                align: 'right'
            });
            doc.text(`R ${amount.toFixed(2)}`, columnBedragX, y, {
                width: 70,
                align: 'right'
            });

            doc.moveDown(1.2);
        });

        doc.moveDown(0.5);
        doc.lineWidth(0.5)
            .moveTo(pageMargin, doc.y)
            .lineTo(pageMargin + contentWidth, doc.y)
            .stroke();

        doc.moveDown(1);
        const totalsY = doc.y;

        doc.font('Helvetica-Bold').fontSize(10);
        doc.text('Totale Ure:', columnPerUurX, totalsY, {
            width: 70,
            align: 'right'
        });
        doc.text(totalHours.toFixed(1), columnBedragX,totalsY, {
            width: 70,
            align: 'right'
        });

        doc.moveDown(1);

        const payableY = doc.y;
        doc.font('Helvetica-Bold').fontSize(10);
        doc.text('Betaalbaar:', columnPerUurX,payableY, {
            width: 70,
            align: 'right'
        });
        doc.text(`R ${totalCost.toFixed(2)}`, columnBedragX, payableY, {
            width: 70,
            align: 'right'
        });

        doc.moveDown(2);
        doc.font('Helvetica-Oblique').fontSize(8)
            .text(
                'Graag versoek ek dat rekeninge binne 7 dae van ontvangs van faktuur betaal word.',
                pageMargin,
                doc.y
            );

        doc.end();
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
    });
}

// ====================
// Database connection
// ====================
async function connectToMongoDB() {
    try {
        await fs.mkdir(INVOICES_DIR, { recursive: true });
        const client = new MongoClient(MONGO_URI, {
            serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true }
        });
        await client.connect();
        db = client.db(DB_NAME);
        console.log("Successfully connected to MongoDB!");
    } catch (err) {
        console.error("Failed to connect to MongoDB:", err);
        throw err;
    }
}

// ====================
// Invoice Handler
// ====================
async function handleInvoice(student, sessions) {
    let filePath;
    const pdfFileName = `${student.name.replace(/\s/g, '_')}_faktuur_${new Date().toISOString().slice(0, 10)}.pdf`;

    try {
        filePath = path.join(INVOICES_DIR, pdfFileName);
        await generateInvoicePDFStream(student, sessions, filePath);
        const invoiceUrl = await uploadFileToCloudinary(filePath, pdfFileName);

       await transporter.sendMail({
    from: `"Marissa Engelbrecht" <${process.env.EMAIL_USER}>`,
    to: student.parentEmail,
    subject: `Faktuur vir ${student.name}`,
    text: 
         `Goeie dag Ouers,

        Vertrou dit gaan goed.

        Hiermee u kind/kinders se ekstraklas faktuur vir Oktober 2025.

        Graag versoek ek asseblief dat ALLE rekeninge teen die 15de van die maand betaal sal wees. Anders vra ek net dat 'n reëling met my getref word. Byvoorbaat dankie.

        Vriendelike Groete
        Marissa`,
    attachments: [{ filename: pdfFileName, path: filePath }]
});


        await db.collection(SESSION_COLLECTION).updateMany(
            { studentId: student.id },
            { $set: { sent: true } }
        );

        return { success: true, studentName: student.name };
    } catch (err) {
        console.error(`Error processing invoice for ${student.name}:`, err);
        return { success: false, studentName: student.name, error: err.message };
    } finally {
        if (filePath) await fs.unlink(filePath).catch(console.error);
    }
}

// ====================
// Routes
// ====================
// Bulk invoices
app.post('/send-all-invoices', async (req, res) => {
    try {
        const students = await db.collection(STUDENT_COLLECTION).find({}).toArray();
        const sessions = await db.collection(SESSION_COLLECTION).find({}).toArray();

        const invoiceData = students.map(student => ({
  student,
  sessions: sessions.filter(
    s => String(s.studentId) === String(student.id)
  )
}))
.filter(data => data.sessions.length > 0 && data.student.parentEmail);


        if (invoiceData.length === 0)
            return res.status(200).json({ success: true, sentCount: 0, message: "No students with sessions or valid emails found." });

        const results = await Promise.all(invoiceData.map(data => handleInvoice(data.student, data.sessions)));

        const sentCount = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success);
        let errorMessage = failed.length > 0 ? `Failed to send ${failed.length} invoice(s): ${failed.map(f => `${f.studentName} (${f.error})`).join(', ')}.` : null;

        res.json({ success: true, sentCount, error: errorMessage });
    } catch (err) {
        console.error("Bulk invoice error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Individual invoice
// ====================
// Individual Invoice (Auto-generate PDF + Email)
// ====================
app.post('/send-invoice', async (req, res) => {
    try {
        const { studentId } = req.body;

        if (!studentId) 
            return res.status(400).json({ success: false, error: "Missing studentId" });

        // Fetch student
        const student = await db.collection(STUDENT_COLLECTION).findOne({ id: studentId });
        if (!student)
            return res.status(404).json({ success: false, error: "Student not found" });

        // Fetch sessions
        const sessions = await db.collection(SESSION_COLLECTION).find({ studentId }).toArray();
        if (sessions.length === 0)
            return res.status(400).json({ success: false, error: "No sessions found for this student" });

        // Create PDF file
        const pdfFileName = `${student.name.replace(/\s/g, '_')}_faktuur_${new Date().toISOString().slice(0,10)}.pdf`;
        const filePath = path.join(INVOICES_DIR, pdfFileName);

        await generateInvoicePDFStream(student, sessions, filePath);

        // Upload to Cloudinary
        const invoiceUrl = await uploadFileToCloudinary(filePath, pdfFileName);

        // Email invoice
        await transporter.sendMail({
    from: `"Marissa Engelbrecht" <${process.env.EMAIL_USER}>`,
    to: student.parentEmail,
    subject: `Faktuur vir ${student.name}`,
    text:
          `Goeie dag Ouers,

        Vertrou dit gaan goed.

        Hiermee u kind/kinders se ekstraklas faktuur vir Oktober 2025.

        Graag versoek ek asseblief dat ALLE rekeninge teen die 15de van die maand betaal sal wees. Anders vra ek net dat 'n reëling met my getref word. Byvoorbaat dankie.

        Vriendelike Groete
        Marissa`,
    attachments: [{ filename: pdfFileName, path: filePath }]
});


        // Mark sessions as sent
        await db.collection(SESSION_COLLECTION).updateMany(
            { studentId },
            { $set: { sent: true } }
        );

        // Cleanup
        await fs.unlink(filePath).catch(() => {});

        res.json({ success: true, url: invoiceUrl });

    } catch (err) {
        console.error("Individual invoice error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Data endpoints
app.get('/api/data', async (req, res) => {
    try {
        const students = await db.collection(STUDENT_COLLECTION).find({}).toArray();
        const sessions = await db.collection(SESSION_COLLECTION).find({}).toArray();
        res.json({ students, sessions });
    } catch (err) {
        console.error("Error fetching data:", err);
        res.status(500).json({ success: false, error: "Failed to fetch data." });
    }
});

app.post('/api/session', async (req, res) => {
    const sessionData = req.body;
    try {
        await db.collection(SESSION_COLLECTION).updateOne(
            { id: sessionData.id },
            { $set: sessionData },
            { upsert: true }
        );
        res.json({ success: true });
    } catch (err) {
        console.error("Error saving session:", err);
        res.status(500).json({ success: false, error: "Failed to save session." });
    }
});

app.delete('/api/session/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await db.collection(SESSION_COLLECTION).deleteOne({ id: id });
        res.json({ success: true });
    } catch (err) {
        console.error("Error deleting session:", err);
        res.status(500).json({ success: false, error: "Failed to delete session." });
    }
});

app.post('/api/students/sync', async (req, res) => {
    const studentArray = req.body;
    try {
        await db.collection(STUDENT_COLLECTION).deleteMany({});
        if (studentArray.length > 0) await db.collection(STUDENT_COLLECTION).insertMany(studentArray);
        res.json({ success: true });
    } catch (err) {
        console.error("Error syncing students:", err);
        res.status(500).json({ success: false, error: "Failed to sync students." });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'head_dashboard.html'));
});

// ============================
// DOWNLOAD INVOICE (NEW FIXED)
// ============================
// ============================
// DOWNLOAD INVOICE (WORKING)
// ============================
app.get("/download-invoice/:studentId", async (req, res) => {
    try {
        const { studentId } = req.params;

        // Fetch student
        const student = await db.collection(STUDENT_COLLECTION).findOne({ id: studentId });
        if (!student) return res.status(404).send("Student not found.");

        // Fetch sessions
        const studentSessions = await db.collection(SESSION_COLLECTION).find({ studentId }).toArray();
        if (studentSessions.length === 0)
            return res.status(400).send("No sessions for student.");

        // Temp file path
        const pdfFileName = `${student.name.replace(/\s/g, '_')}_faktuur_${Date.now()}.pdf`;
        const filePath = path.join(INVOICES_DIR, pdfFileName);

        // Generate PDF
        await generateInvoicePDFStream(student, studentSessions, filePath);

        // Send file to browser
        res.download(filePath, pdfFileName, async () => {
            await fs.unlink(filePath).catch(() => {});
        });

    } catch (err) {
        console.error("Download error:", err);
        res.status(500).send("Error generating invoice.");
    }
});

// Server startup
const PORT = process.env.PORT || 10000;

connectToMongoDB()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error("Failed to start server due to database error:", err);
    process.exit(1);
  });












