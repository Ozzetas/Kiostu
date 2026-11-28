import { UnitType } from '../../domain/entities/types';
import { formatCentsToUSD } from './money';

export function formatStockQty(qty: number, unitType: UnitType): string {
  if (unitType === 'UNIT') {
    return `${qty} u.`;
  }

  if (qty >= 1000) {
    const kg = qty / 1000;
    const formatted = qty % 1000 === 0 ? String(kg) : kg.toFixed(2).replace('.', ',');
    return `${formatted} kg`;
  }

  return `${qty} g`;
}

export function formatPriceLabel(
  unitPriceCents: number,
  unitType: UnitType,
  priceBaseQty: number
): string {
  const formattedPrice = formatCentsToUSD(unitPriceCents);
  if (unitType === 'UNIT') {
    return `${formattedPrice} / u.`;
  }
  if (priceBaseQty === 1000) {
    return `${formattedPrice} / kg`;
  }
  return `${formattedPrice} / ${priceBaseQty}g`;
}

export function formatCentsForInput(cents: number): string {
  const dollars = Math.floor(cents / 100);
  const remainder = cents % 100;
  if (remainder === 0) {
    return String(dollars);
  }
  return `${dollars}.${String(remainder).padStart(2, '0')}`;
}