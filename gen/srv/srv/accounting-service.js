import cds from '@sap/cds';
import { createRequire } from 'module';
import {
    getSAPDocumentTypeMappings,
    getDebitCreditIndicators,
    getRevenueGLMappings,
    getCostCenterMappings,
    getPaymentMethodGLMappings
} from './central-config-client.js';

const require = createRequire(import.meta.url);
const { postJournalEntry } = require('./s4h-journal.cjs');

const S4H_COMPANY_CODE = '11AA'; // TODO: derive from HospitalCompanyMapping

export default class AccountingService extends cds.ApplicationService {
    async init() {
        this.on('import', async (req) => {
            const { batches } = req.data;

            if (!batches || batches.length === 0) {
                req.error(400, 'batches array is required and must not be empty');
                return;
            }

            const db = await cds.connect.to('db');

            await db.transaction(async (tx) => {
                for (const batch of batches) {
                    const { items = [], payments = [], ...batchData } = batch;

                    // 1. Insert batch
                    const batchId = cds.utils.uuid();
                    await tx.insert({
                        ID: batchId,
                        ...batchData
                    }).into('com.hospital.accounting.Batches');

                    // 2. Insert items
                    for (const item of items) {
                        await tx.insert({
                            ID: cds.utils.uuid(),
                            batch_ID: batchId,
                            ...item
                        }).into('com.hospital.accounting.Items');
                    }

                    // 3. Insert payments
                    for (const payment of payments) {
                        await tx.insert({
                            ID: cds.utils.uuid(),
                            batch_ID: batchId,
                            ...payment
                        }).into('com.hospital.accounting.Payments');
                    }
                }
            });

            return `Imported ${batches.length} batch(es) successfully`;
        });

        this.on('postFI', async (req) => {
            const { hisDocumentType, billDate, batchId } = req.data;
            const db = await cds.connect.to('db');

            const summary = { processed: 0, skipped: 0, failed: 0, docs: 0, errors: [] };

            // ── Helper: process one batch ─────────────────────────────────────
            const processBatch = async (batch) => {
                try {
                    // Skip if already posted
                    const existing = await db.run(
                        SELECT.from('com.hospital.accounting.JournalEntryPostings')
                            .where({ batch_ID: batch.ID }).limit(1)
                    );
                    if (existing.length > 0) { summary.skipped++; return; }

                    // Read items
                    const items = await db.run(
                        SELECT.from('com.hospital.accounting.Items').where({ batch_ID: batch.ID })
                    );
                    if (!items || items.length === 0) {
                        summary.errors.push(`Batch ${batch.ID}: no items`);
                        summary.failed++; return;
                    }

                    const billDateStr = (batch.billDate || '').split('T')[0]
                                     || new Date().toISOString().split('T')[0];

                    const [
                        sapDocumentTypeMappings,
                        debitCreditIndicators,
                        revenueGLMappings,
                        costCenterMappings,
                        paymentMethodGLMappings
                    ] = await Promise.all([
                        getSAPDocumentTypeMappings(batch.hospitalCode, batch.hisDocumentType),
                        getDebitCreditIndicators(batch.hospitalCode),
                        getRevenueGLMappings(batch.hospitalCode, batch.hisDocumentType, billDateStr),
                        getCostCenterMappings(batch.hospitalCode, billDateStr),
                        getPaymentMethodGLMappings(batch.hospitalCode, batch.hisDocumentType, billDateStr)
                    ]);

                    if (!sapDocumentTypeMappings.length) {
                        summary.errors.push(`Batch ${batch.ID}: SAPDocumentTypeMapping missing for ${batch.hospitalCode}/${batch.hisDocumentType}`);
                        summary.failed++; return;
                    }

                    const centralConfig = {
                        sapDocumentTypeMappings,
                        debitCreditIndicators,
                        revenueGLMappings,
                        costCenterMappings,
                        paymentMethodGLMappings
                    };

                    const payments = await db.run(
                        SELECT.from('com.hospital.accounting.Payments').where({ batch_ID: batch.ID })
                    );

                    const groups = new Map();
                    for (const item of items) {
                        const key = item.billingGroup || 'DEFAULT';
                        if (!groups.has(key)) groups.set(key, []);
                        groups.get(key).push(item);
                    }

                    const postingResults = [];
                    const errorResults   = [];
                    let seqNo = 1;

                    for (const [groupKey, groupItems] of groups.entries()) {
                        const docRefId = `${(batch.accountingDocumentNumber || batch.ID)
                            .substring(0, 13)}-${seqNo}`;
                        try {
                            const s4Result = await postJournalEntry({
                                companyCode:         S4H_COMPANY_CODE,
                                documentDate:        billDateStr,
                                postingDate:         billDateStr,
                                documentReferenceID: docRefId.substring(0, 16),
                                currency:            batch.currency || 'THB',
                                hisDocumentType:     batch.hisDocumentType,
                                batch,
                                items:               groupItems,
                                payments,
                                centralConfig
                            });
                            postingResults.push({ groupKey, groupItems, seqNo, ...s4Result });
                        } catch (soapErr) {
                            const errMsg = soapErr.message;
                            summary.errors.push(`Batch ${batch.ID} group ${groupKey}: ${errMsg}`);
                            errorResults.push({ groupKey, groupItems, seqNo, errorMessage: errMsg });
                        }
                        seqNo++;
                    }

                    await db.transaction(async (tx) => {
                        for (const pr of postingResults) {
                            const postingId = cds.utils.uuid();
                            await tx.insert({
                                ID:                         postingId,
                                batch_ID:                   batch.ID,
                                JournalEntryCompanyCode:    pr.companyCode,
                                JournalEntryDocumentNumber: pr.documentNo,
                                JournalEntryYear:           pr.fiscalYear,
                                JournalEntryStatus:         'POSTED'
                            }).into('com.hospital.accounting.JournalEntryPostings');

                            const msgs = [
                                { line: 1, text: `FI Document ${pr.documentNo}/${pr.fiscalYear} posted to S/4HANA`, type: 'S' },
                                { line: 2, text: `Billing group: ${pr.groupKey}, Items: ${pr.groupItems.length}`, type: 'I' },
                                { line: 3, text: `Company code: ${pr.companyCode}`, type: 'I' }
                            ];
                            for (const m of msgs) {
                                await tx.insert({
                                    ID:                     cds.utils.uuid(),
                                    journalEntryPosting_ID: postingId,
                                    lineNumber:             m.line,
                                    message:                m.text,
                                    msgType:                m.type
                                }).into('com.hospital.accounting.JournalEntryMessages');
                            }
                            for (const item of pr.groupItems) {
                                await tx.update('com.hospital.accounting.Items')
                                    .set({ fiPosting_ID: postingId })
                                    .where({ ID: item.ID });
                            }
                            summary.docs++;
                        }

                        for (const er of errorResults) {
                            const postingId = cds.utils.uuid();
                            await tx.insert({
                                ID:                         postingId,
                                batch_ID:                   batch.ID,
                                JournalEntryCompanyCode:    S4H_COMPANY_CODE,
                                JournalEntryDocumentNumber: '',
                                JournalEntryYear:           billDateStr.substring(0, 4),
                                JournalEntryStatus:         'ERROR'
                            }).into('com.hospital.accounting.JournalEntryPostings');
                            await tx.insert({
                                ID:                     cds.utils.uuid(),
                                journalEntryPosting_ID: postingId,
                                lineNumber:             1,
                                message:                er.errorMessage,
                                msgType:                'E'
                            }).into('com.hospital.accounting.JournalEntryMessages');
                            for (const item of er.groupItems) {
                                await tx.update('com.hospital.accounting.Items')
                                    .set({ fiPosting_ID: postingId })
                                    .where({ ID: item.ID });
                            }
                        }
                    });

                    if (postingResults.length === 0) { summary.failed++; return; }
                    summary.processed++;

                } catch (err) {
                    summary.failed++;
                    summary.errors.push(`Batch ${batch.ID}: ${err.message}`);
                }
            };
            // ─────────────────────────────────────────────────────────────────

            // 1. Single batch by ID
            if (batchId) {
                const single = await db.run(
                    SELECT.one.from('com.hospital.accounting.Batches').where({ ID: batchId })
                );
                if (!single) { req.error(404, `Batch ${batchId} not found`); return; }
                await processBatch(single);

            } else {
                // 2. Package-size loop (เหมือน ABAP SELECT ... PACKAGE SIZE 100)
                if (!hisDocumentType || !billDate) {
                    req.error(400, 'Provide either batchId OR both hisDocumentType and billDate');
                    return;
                }

                const PACKAGE_SIZE = 3;
                let offset       = 0;
                let totalFetched = 0;

                while (true) {
                    const pkg = await db.run(
                        SELECT.from('com.hospital.accounting.Batches')
                            .where({ hisDocumentType, billDate })
                            .limit(PACKAGE_SIZE, offset)
                    );
                    if (!pkg || pkg.length === 0) break;

                    totalFetched += pkg.length;
                    offset       += pkg.length;

                    for (const batch of pkg) {
                        await processBatch(batch);
                    }

                    if (pkg.length < PACKAGE_SIZE) break;   // package สุดท้าย
                }

                if (totalFetched === 0)
                    return `No batches found for hisDocumentType=${hisDocumentType}, billDate=${billDate}`;
            }

            const errorPart = summary.errors.length > 0
                ? ` | ERRORS: ${summary.errors.join('; ')}` : '';
            return `postFI done — processed: ${summary.processed}, skipped: ${summary.skipped}, failed: ${summary.failed}, FI docs: ${summary.docs}${errorPart}`;
        });

        await super.init();
    }
}
