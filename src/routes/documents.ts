// src/routes/documents.ts
import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import {
  createDocumentSchema,
  listDocumentsSchema,
  documentParamsSchema,
} from '../validators/document.validator';
import { createDocument, deleteDocument, getDocument, listDocuments } from '../controllers/document.controller';
import { requirePermission } from '../middleware/authorize';

const router = Router();
router.use(authenticate); // All document routes require auth

// List documents — requires documents:read
router.get('/',
  requirePermission('documents:read'),
  validate(listDocumentsSchema),
  listDocuments
);

// Get single document — requires documents:read (ownership checked in controller)
router.get('/:id',
  requirePermission('documents:read'),
  validate(documentParamsSchema),
  getDocument
);

// Create document — requires documents:create
router.post('/',
  requirePermission('documents:create'),
  validate(createDocumentSchema),
  createDocument
);

// Delete document — requires documents:delete
router.delete('/:id',
  requirePermission('documents:delete'),
  validate(documentParamsSchema),
  deleteDocument
);

export default router;
