namespace com.hospital.accounting;
using { cuid } from '@sap/cds/common';

// ─────────────────────────────────────────────
//  Enums
// ─────────────────────────────────────────────

type HisDocumentType : String(25) enum {
    INVOICE_OPD;
    INVOICE_IPD_INTERIM;
    INVOICE_IPD_FINAL;
    RECEIPT_OPD;
    RECEIPT_IPD_INTERIM;
    RECEIPT_IPD_FINAL;
    ONWARD;
    CREDIT_NOTE;
    DEBIT_NOTE;
    DEPOSIT;
    REFUND_DEPOSIT;
}

type PaymentMethod : String(10) enum {
    CASH;
    TRANSFER;
    EDC;
    QR;
    VOUCHER;
    DEPOSIT;
}

type BankCode : String(10) enum {
    BBL; KBANK; KTB; TTB; SCB; BAY;
    KKP; CIMBT; TISCO; UOBT; TCD;
    LHFG; ICBCT; SME; BAAC; EXIM;
    GSB; GHB;
}

// ─────────────────────────────────────────────
//  Batches  (top-level document)
// ─────────────────────────────────────────────

entity Batches : cuid {
    hisDocumentType                   : HisDocumentType  not null;
    hospitalCode                      : String(20)       not null;
    accountingDocumentNumber          : String(50)       not null;
    billDate                          : Date             not null;
    cashierUsername                   : String(100)      not null;
    currency                          : String(3)        not null;
    hospitalNumber                    : String(50)       not null;
    visitNumber                       : String(50);
    payorCode                         : String(50);
    oneTimePayorName1                 : String(200);
    oneTimePayorName2                 : String(200);
    coverageType                      : String(50);
    patientGroup                      : String(50);
    marketChannel                     : String(50);
    referenceAccountingDocumentNumber : String(50);
    discountHeaderAmount              : Decimal(15,2);
    roundOffAmount                    : Decimal(15,2);
    isCancel                          : Boolean;

    items              : Composition of many Items              on items.batch              = $self;
    payments           : Composition of many Payments           on payments.batch           = $self;
    journalEntryPostings : Composition of many JournalEntryPostings on journalEntryPostings.batch = $self;
}

// ─────────────────────────────────────────────
//  Items  (line items ของแต่ละ batch)
// ─────────────────────────────────────────────

entity Items : cuid {
    batch                    : Association to Batches  not null;
    itemNumber               : Integer                 not null;
    itemCode                 : String(50)              not null;
    itemName                 : String(200)             not null;
    packageCode              : String(50);
    totalAmount              : Decimal(15,2)           not null;
    discountAmount           : Decimal(15,2);
    netAmount                : Decimal(15,2)           not null;
    taxAmount                : Decimal(15,2);
    taxCode                  : String(20);
    requestingDepartmentCode : String(50);
    performingDepartmentCode : String(50);
    doctorCode               : String(50);
    doctorName               : String(200);
    quantity                 : Decimal(10,3)           not null;
    unitOfMeasure            : String(20);
    patientType              : String(20);
    orderCategory            : String(50);
    orderSubCategory         : String(50);
    billingGroup             : String(50);
    billingSubGroup          : String(50);
    fiPosting                : Association to JournalEntryPostings;
}

// ─────────────────────────────────────────────
//  Payments  (การชำระเงินของ batch)
// ─────────────────────────────────────────────

entity Payments : cuid {
    batch                  : Association to Batches  not null;
    paymentRunningNumber   : Integer                 not null;
    paymentMethod          : PaymentMethod           not null;
    voucherCode            : String(50);
    paymentReferenceNumber : String(100);
    paymentAmount          : Decimal(15,2)           not null;
    depositReferenceNumber : String(50);
    bankTransactionNumber  : String(100);
    bankCode               : BankCode;
    edcTerminalId          : String(50);
    edcApprovalCode        : String(50);
}

// ─────────────────────────────────────────────
//  JournalEntryPostings  (ผลลัพธ์จากการ POST FI Doc)
// ─────────────────────────────────────────────

entity JournalEntryPostings : cuid {
    batch                      : Association to Batches  not null;
    JournalEntryCompanyCode    : String(4);
    JournalEntryDocumentNumber : String(10);
    JournalEntryYear           : String(4);
    JournalEntryStatus         : String(10);
    messages                   : Composition of many JournalEntryMessages
                                     on messages.journalEntryPosting = $self;
}

// ─────────────────────────────────────────────
//  JournalEntryMessages  (messages จากการ POST)
// ─────────────────────────────────────────────

entity JournalEntryMessages : cuid {
    journalEntryPosting : Association to JournalEntryPostings  not null;
    lineNumber          : Integer      not null;
    message             : String(500)  not null;
    msgType             : String(1);   // E=Error W=Warning S=Success I=Info
}
