import type { CategoryDef, DocumentTypeDef, DocumentTypeId } from "../types";

export const CATEGORIES: CategoryDef[] = [
  { id: "home", label: "Home" },
  { id: "money", label: "Money" },
  { id: "identity", label: "Identity" },
  { id: "car", label: "Car" },
  { id: "other", label: "Other" },
];

export const DOCUMENT_TYPES: DocumentTypeDef[] = [
  {
    id: "council_tax",
    label: "Council Tax",
    categoryId: "home",
    folderName: "Council Tax",
    freshnessMonths: 14,
    keywords: ["council tax", "council tax bill", "valuation band", "dwelling", "local authority"],
    filenameHints: ["council", "council-tax", "counciltax"],
  },
  {
    id: "utility_bill",
    label: "Utility Bills",
    categoryId: "home",
    folderName: "Utility Bills",
    freshnessMonths: 3,
    keywords: ["electricity", "gas bill", "water bill", "energy bill", "kilowatt", "standing charge"],
    filenameHints: ["utility", "energy", "electric", "gas", "water"],
  },
  {
    id: "tenancy",
    label: "Tenancy",
    categoryId: "home",
    folderName: "Tenancy",
    freshnessMonths: 24,
    keywords: ["tenancy agreement", "assured shorthold", "landlord", "deposit protection", "tenant"],
    filenameHints: ["tenancy", "lease", "rental"],
  },
  {
    id: "bank_statement",
    label: "Bank Statements",
    categoryId: "money",
    folderName: "Bank Statements",
    freshnessMonths: 3,
    keywords: ["bank statement", "sort code", "account number", "available balance", "statement of account"],
    filenameHints: ["statement", "bank"],
  },
  {
    id: "payslip",
    label: "Payslips",
    categoryId: "money",
    folderName: "Payslips",
    freshnessMonths: 2,
    keywords: ["payslip", "pay slip", "paye", "national insurance", "net pay", "gross pay"],
    filenameHints: ["payslip", "paye", "salary"],
  },
  {
    id: "tax",
    label: "Tax",
    categoryId: "money",
    folderName: "Tax",
    freshnessMonths: 14,
    keywords: ["self assessment", "hmrc", "tax return", "p60", "p45", "unique taxpayer"],
    filenameHints: ["tax", "hmrc", "p60", "p45"],
  },
  {
    id: "passport",
    label: "Passport",
    categoryId: "identity",
    folderName: "Passport",
    expiryTracked: true,
    keywords: ["passport", "nationality", "place of birth", "machine readable"],
    filenameHints: ["passport"],
  },
  {
    id: "driving_licence",
    label: "Driving Licence",
    categoryId: "identity",
    folderName: "Driving Licence",
    expiryTracked: true,
    keywords: ["driving licence", "driving license", "dvla", "photocard"],
    filenameHints: ["licence", "license", "dvla", "driving"],
  },
  {
    id: "car_insurance",
    label: "Car Insurance",
    categoryId: "car",
    folderName: "Insurance",
    freshnessMonths: 12,
    keywords: ["motor insurance", "car insurance", "policy schedule", "certificate of motor", "renewal premium"],
    filenameHints: ["insurance", "motor", "policy"],
  },
  {
    id: "mot",
    label: "MOT",
    categoryId: "car",
    folderName: "MOT",
    expiryTracked: true,
    keywords: ["mot test", "mot certificate", "vt20", "vehicle registration"],
    filenameHints: ["mot"],
  },
  {
    id: "v5c",
    label: "V5C",
    categoryId: "car",
    folderName: "V5C",
    freshnessMonths: 60,
    keywords: ["v5c", "log book", "registered keeper", "vehicle registration certificate"],
    filenameHints: ["v5c", "logbook", "log-book"],
  },
  {
    id: "other",
    label: "Other",
    categoryId: "other",
    folderName: "Other",
    keywords: [],
    filenameHints: [],
  },
];

let extraCategories: CategoryDef[] = [];
let extraTypes: DocumentTypeDef[] = [];

export function setCatalogExtras(categories: CategoryDef[] = [], types: Array<{ id: string; label: string; categoryId: string }> = []) {
  extraCategories = categories;
  extraTypes = types.map((type) => ({
    id: type.id as DocumentTypeId,
    label: type.label,
    categoryId: type.categoryId,
    folderName: type.label,
    keywords: [],
    filenameHints: [],
  }));
}

export function allCategories(): CategoryDef[] {
  return [...CATEGORIES, ...extraCategories];
}

export function allTypes(): DocumentTypeDef[] {
  return [...DOCUMENT_TYPES, ...extraTypes];
}

export function typeById(id: DocumentTypeId | string): DocumentTypeDef {
  return allTypes().find((type) => type.id === id) ?? DOCUMENT_TYPES[DOCUMENT_TYPES.length - 1];
}

export function categoryLabel(id: string): string {
  return allCategories().find((category) => category.id === id)?.label ?? "Other";
}

export function suggestedPath(typeId: DocumentTypeId, period?: string): string {
  const type = typeById(typeId);
  const category = categoryLabel(type.categoryId);
  return period
    ? `${category} → ${type.folderName} → ${period}`
    : `${category} → ${type.folderName}`;
}
