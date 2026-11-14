export type ShipmentState = 'reserved' | 'shipped' | 'tracking_review';
export const MAX_BATCH_REFS = 500;
export type BulkShipment = { ref: string; tracking: string };
export type BulkShipmentMatch = {
  ref: string;
  tracking: string | null;
  state: 'eligible' | ShipmentState | 'brand_review' | 'page_review' | 'unavailable';
};
export type PrintPage = {
  page: number;
  ref: string | null;
  tracking: string | null;
  carrier: string;
  role: string;
  excluded: boolean;
  shipment: { state: ShipmentState; actor: string; at: string; canRelease: boolean; canOpen: boolean } | null;
};
export type PrintPlan = {
  pages: PrintPage[];
  printable: number;
  canExportOriginal: boolean;
  batch: { id: string; current: boolean } | null;
};
