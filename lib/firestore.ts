/**
 * Typed helpers for reading Firestore documents.
 *
 * Firestore's client SDK returns `DocumentData` (an alias for `any`) from
 * `snap.data()`, which is why our page files are riddled with
 *   `snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))`.
 *
 * `mapDoc<T>` and `mapSnapshot<T>` give us a single blessed spot where the
 * `any` lives, so the call sites can be `any`-free and still keep the
 * `id` field consistently on top.
 *
 * Usage:
 *
 *   import type { Invoice } from "@/types";
 *   const rows = mapSnapshot<Invoice>(snap);
 *   // rows: (Invoice & { id: string })[]
 */

import type {
    DocumentData,
    DocumentSnapshot,
    QueryDocumentSnapshot,
    QuerySnapshot,
} from "firebase/firestore";

/** Attach the doc id onto the payload with a strict output type. */
export function mapDoc<T>(
    snap: QueryDocumentSnapshot<DocumentData> | DocumentSnapshot<DocumentData>,
): T & { id: string } {
    // `snap.data()` on a QueryDocumentSnapshot is guaranteed non-undefined,
    // and on a DocumentSnapshot we treat missing docs as {}.
    const data = (snap.data() ?? {}) as T;
    return { ...data, id: snap.id };
}

/** Map every doc in a QuerySnapshot with `mapDoc`. */
export function mapSnapshot<T>(snap: QuerySnapshot<DocumentData>): (T & { id: string })[] {
    return snap.docs.map((d) => mapDoc<T>(d));
}
