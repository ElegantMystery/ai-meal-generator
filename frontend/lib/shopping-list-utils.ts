export type ShoppingListItem = {
  id: number;
  name: string;
  qty: number;
  price?: number | null;
  unitSize?: string | null;
  imageUrl?: string | null;
  lineTotal?: number | null;
  neededAmount?: number | null;
  neededUnit?: string | null;
  quantityEstimated?: boolean;
};

function formatNumber(value: number): string {
  return String(parseFloat(value.toPrecision(10)));
}

export function formatShoppingQuantityDetails(item: ShoppingListItem): string {
  const parts: string[] = [];
  if (item.neededAmount != null && item.neededUnit) {
    parts.push(`Need ${formatNumber(item.neededAmount)} ${item.neededUnit}`);
  }
  parts.push(item.unitSize ? `${item.qty} × ${item.unitSize}` : `${item.qty} package${item.qty === 1 ? "" : "s"}`);
  if (item.quantityEstimated) parts.push("Quantity estimated");
  return parts.join(" · ");
}

export function buildShoppingListClipboardText(
  items: ShoppingListItem[],
): string {
  return items
    .map((item) => {
      const parts = [`${item.qty}x ${item.name}`];
      if (item.unitSize) parts.push(item.unitSize);
      if (item.neededAmount != null && item.neededUnit) {
        parts.push(`need ${formatNumber(item.neededAmount)} ${item.neededUnit}`);
      }
      if (item.quantityEstimated) parts.push("quantity estimated");
      const price = item.price != null ? ` ($${item.price.toFixed(2)})` : "";
      return `${parts.join(" - ")}${price}`;
    })
    .join("\n");
}
