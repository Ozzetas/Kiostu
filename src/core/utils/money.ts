import { ArithmeticOverflowError, ValidationError } from '../errors/AppError';

const CURRENCY_INPUT_REGEX = /^\d+([.,]\d{1,2})?$/;

const ARS_FORMATTER = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function parseCurrencyToCents(rawInput: string): number {
  const cleaned = rawInput.trim();

  if (!CURRENCY_INPUT_REGEX.test(cleaned)) {
    throw new ValidationError('Formato monetario inválido. Usar hasta 2 decimales.', {
      rawInput,
    });
  }

  // Parseo parte entera y decimal como texto para evitar errores binarios IEEE 754 (ej: 19.99 * 100).
  const [integerPart = '0', rawDecimalPart = ''] = cleaned.split(/[.,]/);
  const normalizedDecimal = rawDecimalPart.padEnd(2, '0');
  const cents = Number(integerPart) * 100 + Number(normalizedDecimal);

  if (!Number.isSafeInteger(cents)) {
    throw new ArithmeticOverflowError('El monto ingresado excede el límite entero seguro.', {
      rawInput,
    });
  }

  return cents;
}

export function calculateLineSubtotalCents(
  unitPriceCents: number,
  priceBaseQty: number,
  quantity: number
): number {
  if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0) {
    throw new ValidationError('El precio unitario en centavos debe ser un entero >= 0.', {
      unitPriceCents,
    });
  }
  if (!Number.isSafeInteger(priceBaseQty) || priceBaseQty <= 0) {
    throw new ValidationError('La cantidad base del precio debe ser un entero > 0.', {
      priceBaseQty,
    });
  }
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new ValidationError('La cantidad vendida debe ser un entero > 0.', {
      quantity,
    });
  }

  const numerator = unitPriceCents * quantity;
  if (!Number.isSafeInteger(numerator)) {
    throw new ArithmeticOverflowError('Desbordamiento aritmético al calcular subtotal.', {
      unitPriceCents,
      quantity,
      priceBaseQty,
    });
  }

  return Math.round(numerator / priceBaseQty);
}

export function formatCentsToARS(cents: number): string {
  if (!Number.isSafeInteger(cents)) {
    throw new ValidationError('Los centavos a formatear deben ser un entero seguro.', { cents });
  }
  return ARS_FORMATTER.format(cents / 100);
}