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

const router = Router();
router.use(authenticate); // All document routes require auth

router.get('/',
  validate(listDocumentsSchema),
  listDocuments
);

router.post('/',
  validate(createDocumentSchema),
  createDocument
);

router.get('/:id',
  validate(documentParamsSchema),
  getDocument
);

router.delete('/:id',
  validate(documentParamsSchema),
  deleteDocument
);

export default router;
