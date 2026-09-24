'use strict';
const soap = require('soap');
const path = require('path');

const WSDL_PATH = path.join(__dirname, 'wsdl', 'JOURNALENTRYCREATEREQUESTCONFI.wsdl');
const SOAP_PATH = '/sap/bc/srt/scs_ext/sap/journalentrycreaterequestconfi';

// ─── Read credentials from BTP Destination service ────────────────────────────

async function getCredentials() {
    const vcap = JSON.parse(process.env.VCAP_SERVICES || '{}');
    const destSvc = Object.values(vcap).flat()
        .find(s => s.label === 'destination' ||
                   (Array.isArray(s.tags) && s.tags.includes('destination')));

    if (!destSvc) {
        const url  = process.env.S4H_URL;
        const user = process.env.S4H_USERNAME;
        const pass = process.env.S4H_PASSWORD;
        if (url && user && pass) return { username: user, password: pass, baseUrl: url };
        return null;
    }

    const c = destSvc.credentials;
    const tokenRes = await fetch(`${c.url}/oauth/token`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type:    'client_credentials',
            client_id:     c.clientid,
            client_secret: c.clientsecret
        })
    });
    const { access_token } = await tokenRes.json();

    const destRes = await fetch(
        `${c.uri}/destination-configuration/v1/destinations/S4H_SOAP_DEST`,
        { headers: { Authorization: `Bearer ${access_token}` } }
    );
    const dest  = await destRes.json();
    const props = dest?.destinationConfiguration || {};
    return { username: props.User, password: props.Password, baseUrl: props.URL };
}

// ═══════════════════════════════════════════════════════════════════════════════
// BUILDER 1: สร้าง item lines (revenue / discount / cost / reconcile)
// ═══════════════════════════════════════════════════════════════════════════════

function buildItemLines(hisDocumentType, { items, revenueGLByItemCode, costCenterByDept, dcRow, currency, batch }) {
    const lines = [];
    const noDiscount = ['CREDIT_NOTE', 'DEBIT_NOTE'].includes(hisDocumentType);

    const buildAccountAssignment = (glAccount, costCenter, item) => {
        const base = { CostCenter: costCenter };
        if (/^[45]/.test(glAccount)) {
            return {
                ...base,
                'n1:YY1_HospitalNumber':   batch.hospitalNumber,
                'n1:YY1_VisitNumber':      batch.visitNumber,
                'n1:YY1_CoverageCode':     batch.coverageType,
                'n1:YY1_PatientGroup':     batch.patientGroup,
                'n1:YY1_MarketChannel':    batch.marketChannel,
                'n1:YY1_PatientType':      item.patientType,
                'n1:YY1_OrderCategory':    item.orderCategory,
                'n1:YY1_OrderSubCategory': item.orderSubCategory,
                'n1:YY1_RequestDeptCode':  item.requestingDepartmentCode,
                'n1:YY1_PerformDeptCode':  item.performingDepartmentCode,
            };
        }
        return base;
    };

    for (const item of items) {
        const revenueGL  = revenueGLByItemCode[item.itemCode];
        const costCenter = costCenterByDept[item.requestingDepartmentCode] ?? '';

        if (!revenueGL) throw new Error(`RevenueGLMapping not found for itemCode=${item.itemCode}`);

        if (revenueGL.glRevenue) {
            lines.push({
                ReferenceDocumentItem: '',
                GLAccount:             revenueGL.glRevenue,
                DebitCreditCode:       dcRow?.revenue || 'C',
                AmountInTransactionCurrency: {
                    attributes: { currencyCode: currency },
                    $value:     parseFloat(item.totalAmount || 0)
                },
                Tax: { TaxCode: item.taxCode },
                AccountAssignment: buildAccountAssignment(revenueGL.glRevenue, costCenter, item)
            });
        }

        if (revenueGL.glDiscontItem && !noDiscount) {
            lines.push({
                ReferenceDocumentItem: '',
                GLAccount:             revenueGL.glDiscontItem,
                DebitCreditCode:       dcRow?.discountItem || 'D',
                AmountInTransactionCurrency: {
                    attributes: { currencyCode: currency },
                    $value:     parseFloat(item.discountAmount || 0)
                },
                Tax: { TaxCode: item.taxCode },
                AccountAssignment: buildAccountAssignment(revenueGL.glDiscontItem, costCenter, item)
            });
        }

        if (revenueGL.glCost) {
            lines.push({
                ReferenceDocumentItem: '',
                GLAccount:             revenueGL.glCost,
                DebitCreditCode:       dcRow?.cost || 'C',
                AmountInTransactionCurrency: {
                    attributes: { currencyCode: currency },
                    $value:     parseFloat(revenueGL.standardCost || 0)
                },
                Tax: { TaxCode: item.taxCode },
                AccountAssignment: buildAccountAssignment(revenueGL.glCost, costCenter, item)
            });
        }

        if (revenueGL.glReconcileCost) {
            lines.push({
                ReferenceDocumentItem: '',
                GLAccount:             revenueGL.glReconcileCost,
                DebitCreditCode:       dcRow?.reconcileCost || 'C',
                AmountInTransactionCurrency: {
                    attributes: { currencyCode: currency },
                    $value:     parseFloat(revenueGL.standardCost || 0)
                },
                Tax: { TaxCode: item.taxCode },
                AccountAssignment: buildAccountAssignment(revenueGL.glReconcileCost, costCenter, item)
            });
        }
    }

    return lines;
}

// ═══════════════════════════════════════════════════════════════════════════════
// BUILDER 2: สร้าง payment lines
// ═══════════════════════════════════════════════════════════════════════════════

function buildPaymentLines(hisDocumentType, { payments, paymentGLByMethod, dcRow, currency }) {
    return payments.map(payment => {
        const glAccount = paymentGLByMethod[payment.paymentMethod];
        if (!glAccount) throw new Error(`PaymentMethodGLMapping not found for paymentMethod=${payment.paymentMethod}`);
        const line = {
            ReferenceDocumentItem: '',
            GLAccount:             glAccount,
            DebitCreditCode:       dcRow?.payment || 'D',
            AmountInTransactionCurrency: {
                attributes: { currencyCode: currency },
                $value:     parseFloat(payment.paymentAmount || 0)
            },
            AccountAssignment: { CostCenter: '11AA-10000' }
        };
        if (hisDocumentType === 'ONWARD') line.DocumentItemText = 'Unbilled';
        return line;
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
// BUILDER 3: ประกอบ SOAP requestBody
// ═══════════════════════════════════════════════════════════════════════════════

function buildRequestBody({ companyCode, documentDate, postingDate, documentReferenceID,
                            currency, username, sapDocumentType, itemLines, paymentLines }) {
    const soapItems = [...itemLines, ...paymentLines];
    soapItems.forEach((line, idx) => {
        line.ReferenceDocumentItem = String(idx + 1).padStart(10, '0');
        if (line.DebitCreditCode === 'C') line.AmountInTransactionCurrency.$value *= -1;
    });

    const taxBaseAmount = itemLines.reduce((sum, line) =>
        sum + Math.abs(line.AmountInTransactionCurrency.$value), 0);

    const firstTaxCode = itemLines.find(l => l.Tax?.TaxCode)?.Tax?.TaxCode || 'O0';

    return {
        MessageHeader: {
            ID:                      generateMsgID(),
            CreationDateTime:        new Date().toISOString(),
            SenderBusinessSystemID: 'CAP_SYSTEM'
        },
        JournalEntryCreateRequest: {
            MessageHeader: {
                ID:                      generateMsgID(),
                CreationDateTime:        new Date().toISOString(),
                SenderBusinessSystemID: 'CAP_SYSTEM'
            },
            JournalEntry: {
                OriginalReferenceDocumentType: 'BKPFF',
                BusinessTransactionType:       'RFBU',
                AccountingDocumentType:        sapDocumentType,
                DocumentReferenceID:           documentReferenceID,
                CreatedByUser:                 username.substring(0, 12),
                CompanyCode:                   companyCode,
                DocumentDate:                  documentDate,
                PostingDate:                   postingDate,
                TaxDeterminationDate:          postingDate,
                Item:                          soapItems,
                ProductTaxItem: [{
                    TaxCode:               firstTaxCode,
                    TaxItemClassification: 'MWS',
                    AmountInTransactionCurrency: {
                        attributes: { currencyCode: currency },
                        $value: 0
                    },
                    TaxBaseAmountInTransCrcy: {
                        attributes: { currencyCode: currency },
                        $value: taxBaseAmount
                    }
                }]
            }
        }
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN: orchestrate — เรียก builders แล้วส่ง SOAP
// ═══════════════════════════════════════════════════════════════════════════════

async function postJournalEntry({ companyCode, documentDate, postingDate,
                                   documentReferenceID, currency,
                                   hisDocumentType, batch, items, payments = [], centralConfig }) {
    const creds = await getCredentials();

    // ── Mapping จาก central-config tables ────────────────────────────────────
    const {
        sapDocumentTypeMappings  = [],
        debitCreditIndicators    = [],
        revenueGLMappings        = [],
        costCenterMappings       = [],
        paymentMethodGLMappings  = []
    } = centralConfig || {};

    const sapDocumentType = sapDocumentTypeMappings[0]?.sapDocumentType || 'SA';
    const dcRow           = debitCreditIndicators.find(r => r.sapDocumentType === sapDocumentType);

    const revenueGLByItemCode = Object.fromEntries(revenueGLMappings.map(r => [r.hisItemCode, r]));
    const costCenterByDept    = Object.fromEntries(costCenterMappings.map(r => [r.departmentCode, r.costCenter]));
    const paymentGLByMethod   = Object.fromEntries(paymentMethodGLMappings.map(r => [r.paymentMethod, r.glPayment]));
    // ─────────────────────────────────────────────────────────────────────────

    // Local dev fallback — no Destination service bound
    if (!creds) {
        const mockDocNo = String(Date.now()).slice(-10);
        console.log(`[s4h] MOCK — Destination not bound. docNo=${mockDocNo}, sapDocType=${sapDocumentType}`);
        return { documentNo: mockDocNo, companyCode, fiscalYear: documentDate.substring(0, 4) };
    }

    const itemLines    = buildItemLines(hisDocumentType, { items, revenueGLByItemCode, costCenterByDept, dcRow, currency, batch });
    const paymentLines = buildPaymentLines(hisDocumentType, { payments, paymentGLByMethod, dcRow, currency });
    const requestBody  = buildRequestBody({
        companyCode, documentDate, postingDate, documentReferenceID,
        currency, username: creds.username, sapDocumentType,
        itemLines, paymentLines
    });

    // console.log('[s4h] REQUEST BODY:', JSON.stringify(requestBody, null, 2));

    const client = await soap.createClientAsync(WSDL_PATH, { endpoint: creds.baseUrl + SOAP_PATH });
    client.setSecurity(new soap.BasicAuthSecurity(creds.username, creds.password));

    const [result] = await client.JournalEntryCreateRequestConfirmation_InAsync(requestBody);
    console.log('[s4h] SOAP response:', JSON.stringify(result, null, 2));
    return parseResponse(result, companyCode, documentDate);
}

// ─── Parse SOAP response ───────────────────────────────────────────────────────

function parseResponse(result, companyCode, documentDate) {
    const confirmations = result?.JournalEntryCreateConfirmation;
    const entry = Array.isArray(confirmations) ? confirmations[0] : confirmations;
    if (!entry) throw new Error('No JournalEntryCreateConfirmation in SOAP response');

    const log = entry?.Log;
    if (log?.MaximumLogItemSeverityCode === '3') {
        const items  = log.Item ? (Array.isArray(log.Item) ? log.Item : [log.Item]) : [];
        const errors = items.filter(i => i.SeverityCode === '3');
        const msg    = errors.map(e => e.Note).join('; ') || 'S/4HANA posting failed';
        throw new Error(msg);
    }

    const inner      = entry?.JournalEntryCreateConfirmation;
    const documentNo = inner?.AccountingDocument;
    if (!documentNo || documentNo === '0000000000')
        throw new Error('Journal entry not created — document number is empty');

    return {
        documentNo,
        companyCode: inner?.CompanyCode || companyCode,
        fiscalYear:  inner?.FiscalYear  || documentDate.substring(0, 4)
    };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateMsgID() {
    return 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'.replace(/x/g,
        () => (Math.random() * 16 | 0).toString(16));
}

module.exports = { postJournalEntry };
