
const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = path.join(__dirname, '..', 'uploads');
        if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath);
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

module.exports = (db) => {
    // Health check
    router.get('/health', (req, res) => res.json({ status: 'ok', message: 'API is running' }));

    // Checklist templates
    router.get('/checklists/template/:type', async (req, res, next) => {
        try {
            const templates = await db.getChecklistTemplates();
            const template = templates.find(t => t.equipmentType === req.params.type);
            if (template) {
                res.json(template);
            } else {
                res.status(404).json({ error: 'Checklist template not found' });
            }
        } catch (error) {
            next(error);
        }
    });

    // Service reports
    router.get('/servicereports/equipment/:equipmentId', async (req, res, next) => {
        try {
            const { equipmentId } = req.params;
            const { orderId } = req.query;
            if (!orderId) return res.status(400).json({ error: 'orderId is required' });
            let report = await db.getServiceReportByEquipment(equipmentId, orderId);
            if (report) {
                res.json(report);
            } else {
                const newReportData = { orderId: orderId, equipmentId: equipmentId, status: 'draft', reportData: { components: [], overallComment: '' } };
                const newReport = await db.addServiceReport(newReportData);
                res.status(201).json(newReport);
            }
        } catch (error) {
            next(error);
        }
    });

    router.put('/servicereports/:reportId', async (req, res, next) => {
        try {
            const updatedReport = await db.updateServiceReport(req.params.reportId, req.body);
            if (updatedReport) {
                res.json(updatedReport);
            } else {
                res.status(404).json({ error: 'Service report not found' });
            }
        } catch (error) {
            next(error);
        }
    });

    // File upload
    router.post('/upload', upload.single('photo'), (req, res) => {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
        const fileUrl = `/uploads/${req.file.filename}`;
        res.json({ message: 'File uploaded', url: fileUrl });
    });

    return router;
};
