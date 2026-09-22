using { com.hospital.accounting as accounting } from '../db/schema';

// ─────────────────────────────────────────────
//  Input Types สำหรับ import action
// ─────────────────────────────────────────────

type PaymentInput {
    paymentRunningNumber   : Integer;
    paymentMethod          : accounting.PaymentMethod;
    voucherCode            : String(50);
    paymentReferenceNumber : String(100);
    paymentAmount          : Decimal(15,2);
    depositReferenceNumber : String(50);
    bankTransactionNumber  : String(100);
    bankCode               : accounting.BankCode;
    edcTerminalId          : String(50);
    edcApprovalCode        : String(50);
}

type ItemInput {
    itemNumber               : Integer;
    itemCode                 : String(50);
    itemName                 : String(200);
    packageCode              : String(50);
    totalAmount              : Decimal(15,2);
    discountAmount           : Decimal(15,2);
    netAmount                : Decimal(15,2);
    taxAmount                : Decimal(15,2);
    taxCode                  : String(20);
    requestingDepartmentCode : String(50);
    performingDepartmentCode : String(50);
    doctorCode               : String(50);
    doctorName               : String(200);
    quantity                 : Decimal(10,3);
    unitOfMeasure            : String(20);
    patientType              : String(20);
    orderCategory            : String(50);
    orderSubCategory         : String(50);
    billingGroup             : String(50);
    billingSubGroup          : String(50);
}

type BatchInput {
    hisDocumentType                   : accounting.HisDocumentType;
    hospitalCode                      : String(20);
    accountingDocumentNumber          : String(50);
    billDate                          : Date;
    cashierUsername                   : String(100);
    currency                          : String(3);
    hospitalNumber                    : String(50);
    visitNumber                       : String(50);
    payorCode                         : String(50);
    oneTimePayorName1                 : String(200);
    oneTimePayorName2                 : String(200);
    coverageType                      : String(50);
    patientGroup                      : String(50);
    marketChannel                     : String(50);
    referenceAccountingDocumentNumber : String(50);
    discountHeaderAmount              : Decimal(15,2);
    items                             : array of ItemInput;
    payments                          : array of PaymentInput;
}

// ─────────────────────────────────────────────
//  Service
// ─────────────────────────────────────────────

service AccountingService {
    entity Batches                as projection on accounting.Batches;
    entity Items                  as projection on accounting.Items;
    entity Payments               as projection on accounting.Payments;
    entity JournalEntryPostings   as projection on accounting.JournalEntryPostings;
    entity JournalEntryMessages   as projection on accounting.JournalEntryMessages;

    action import(batches: array of BatchInput) returns String;
    action postFI(hisDocumentType: String, billDate: Date, batchId: UUID) returns String;
}
