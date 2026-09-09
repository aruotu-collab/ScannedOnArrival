import type { DocumentRecord, HouseholdPerson } from "../types";
import { allTypes } from "./taxonomy";

export type PersonFilterId = "all" | "household" | string;

export interface MissingTypeRow {
  key: string;
  typeId: string;
  typeLabel: string;
  detail: string;
  personId?: string;
}

export function ownerKey(personId?: string): string {
  return personId?.trim() || "";
}

export function sameOwner(a: { personId?: string }, b: { personId?: string }): boolean {
  return ownerKey(a.personId) === ownerKey(b.personId);
}

export function personLabel(people: HouseholdPerson[], personId?: string): string {
  if (!ownerKey(personId)) return "Household";
  return people.find((person) => person.id === personId)?.name ?? "Household";
}

export function documentsForFilter(documents: DocumentRecord[], filter: PersonFilterId): DocumentRecord[] {
  if (filter === "all") return documents;
  if (filter === "household") return documents.filter((doc) => !ownerKey(doc.personId));
  return documents.filter((doc) => ownerKey(doc.personId) === filter || !ownerKey(doc.personId));
}

export function missingTypeRows(
  documents: DocumentRecord[],
  people: HouseholdPerson[],
  filter: PersonFilterId,
): MissingTypeRow[] {
  const types = allTypes().filter((type) => type.id !== "other");
  const currents = documents.filter((doc) => doc.isCurrent);

  if (filter !== "all" || people.length === 0) {
    return types
      .filter((type) => !currents.some((doc) => doc.typeId === type.id))
      .map((type) => ({
        key: type.id,
        typeId: type.id,
        typeLabel: type.label,
        detail: filter === "household" ? "No shared copy in the index yet" : "Scan or add a PDF into this type",
      }));
  }

  const rows: MissingTypeRow[] = [];
  for (const type of types) {
    const typeCurrents = currents.filter((doc) => doc.typeId === type.id);
    if (typeCurrents.length === 0) {
      rows.push({
        key: type.id,
        typeId: type.id,
        typeLabel: type.label,
        detail: "Scan or add a PDF into this type",
      });
      continue;
    }
    if (typeCurrents.some((doc) => !ownerKey(doc.personId))) continue;
    const assigned = new Set(typeCurrents.map((doc) => ownerKey(doc.personId)));
    for (const person of people) {
      if (assigned.has(person.id)) continue;
      rows.push({
        key: `${type.id}:${person.id}`,
        typeId: type.id,
        typeLabel: type.label,
        personId: person.id,
        detail: `${person.name} has no copy yet`,
      });
    }
  }
  return rows;
}
