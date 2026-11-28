import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppError } from '../../src/core/errors/AppError';
import { Logger } from '../../src/core/logging/Logger';
import {
  calculateLineSubtotalCents,
  formatCentsToUSD,
  parseCurrencyToCents,
} from '../../src/core/utils/money';
import { parseProductVisual } from '../../src/core/utils/productVisual';
import { formatPriceLabel, formatStockQty } from '../../src/core/utils/units';
import { Customer, PaymentType, Product, SaleTier } from '../../src/domain/entities/types';
import { AgendaPaperBackground } from '../../src/presentation/components/AgendaPaperBackground';
import { ErrorBanner } from '../../src/presentation/components/ErrorBanner';
import { useAppServices } from '../../src/presentation/di/AppServicesProvider';
import { Colors, Radius, Shadows, Spacing, Typography } from '../../src/presentation/theme/tokens';

const logger = new Logger('CheckoutWeightModal');

const GRAM_PRESETS: readonly { readonly label: string; readonly qty: number }[] = [
  { label: '1 g', qty: 1 },
  { label: '10 g', qty: 10 },
  { label: '100 g', qty: 100 },
  { label: '250 g', qty: 250 },
  { label: '500 g', qty: 500 },
  { label: '1 kg', qty: 1000 },
];

const UNIT_PRESETS: readonly number[] = [1, 2, 3, 5, 10];

export default function CheckoutWeightModal() {
  const router = useRouter();
  const params = useLocalSearchParams<{ productId?: string }>();
  const productId = typeof params.productId === 'string' ? params.productId : undefined;
  const { services, notifyDataChanged } = useAppServices();

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [product, setProduct] = useState<Product | null>(null);
  const [customers, setCustomers] = useState<readonly Customer[]>([]);

  const [saleTier, setSaleTier] = useState<SaleTier>('RETAIL');
  const [quantityInput, setQuantityInput] = useState('1');
  const [paymentType, setPaymentType] = useState<PaymentType>('CREDIT');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [partialPaidInput, setPartialPaidInput] = useState('');

  // Alta rápida de cliente dentro del checkout para no cortar la venta en mostrador.
  const [showQuickCustomer, setShowQuickCustomer] = useState(false);
  const [quickCustomerName, setQuickCustomerName] = useState('');
  const [isCreatingCustomer, setIsCreatingCustomer] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadInitialData(): Promise<void> {
      if (productId === undefined) {
        setErrorMessage('No se especificó el producto a vender.');
        setIsLoading(false);
        return;
      }

      try {
        const [loadedProduct, loadedCustomers] = await Promise.all([
          services.productRepository.findById(productId),
          services.customerRepository.listActiveCustomers(),
        ]);

        if (!isMounted) {
          return;
        }

        if (loadedProduct === null) {
          setErrorMessage('El producto seleccionado no existe o fue desactivado.');
        } else {
          setProduct(loadedProduct);
          if (loadedProduct.unitType === 'GRAM') {
            setQuantityInput(loadedProduct.priceBaseQty === 1 ? '1' : '100');
          } else {
            setQuantityInput('1');
          }
        }

        setCustomers(loadedCustomers);
        const firstCustomer = loadedCustomers[0];
        if (firstCustomer !== undefined) {
          setSelectedCustomerId(firstCustomer.id);
        }
      } catch (error: unknown) {
        const normalized = error instanceof Error ? error : new Error(String(error));
        logger.error('Error al cargar datos del checkout rápido', normalized, { productId });
        if (isMounted) {
          setErrorMessage(
            error instanceof AppError ? error.message : 'No se pudo cargar la pantalla de venta.'
          );
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadInitialData();
    return () => {
      isMounted = false;
    };
  }, [services, productId]);

  const parsedQty = useMemo(() => {
    const cleaned = quantityInput.trim();
    if (!/^\d+$/.test(cleaned)) {
      return 0;
    }
    const val = Number(cleaned);
    return Number.isSafeInteger(val) && val > 0 ? val : 0;
  }, [quantityInput]);

  const effectiveUnitPriceCents = useMemo(() => {
    if (product === null) {
      return 0;
    }
    return saleTier === 'WHOLESALE' ? product.wholesalePriceCents : product.unitPriceCents;
  }, [product, saleTier]);

  const { subtotalCents, costSubtotalCents, estimatedProfitCents } = useMemo(() => {
    if (product === null || parsedQty <= 0) {
      return { subtotalCents: 0, costSubtotalCents: 0, estimatedProfitCents: 0 };
    }
    try {
      const subtotal = calculateLineSubtotalCents(
        effectiveUnitPriceCents,
        product.priceBaseQty,
        parsedQty
      );
      const cost = calculateLineSubtotalCents(
        product.costPriceCents,
        product.priceBaseQty,
        parsedQty
      );
      return {
        subtotalCents: subtotal,
        costSubtotalCents: cost,
        estimatedProfitCents: subtotal - cost,
      };
    } catch {
      return { subtotalCents: 0, costSubtotalCents: 0, estimatedProfitCents: 0 };
    }
  }, [product, effectiveUnitPriceCents, parsedQty]);

  const handleStepUnit = (delta: number): void => {
    const next = Math.max(1, parsedQty + delta);
    setQuantityInput(String(next));
  };

  const handleQtyChange = (raw: string): void => {
    const digitsOnly = raw.replace(/[^\d]/g, '');
    if (digitsOnly.length > 1 && digitsOnly.startsWith('0')) {
      setQuantityInput(digitsOnly.replace(/^0+/, ''));
      return;
    }
    setQuantityInput(digitsOnly);
  };

  const handleQuickCreateCustomer = async (): Promise<void> => {
    const cleanName = quickCustomerName.trim();
    if (cleanName.length === 0) {
      setErrorMessage('Ingresá el nombre del cliente.');
      return;
    }

    setErrorMessage(null);
    setIsCreatingCustomer(true);

    try {
      const created = await services.customerRepository.createCustomer({
        fullName: cleanName,
        phone: null,
        notes: null,
      });
      setCustomers((prev) =>
        [...prev, created].sort((a, b) => a.fullName.localeCompare(b.fullName))
      );
      setSelectedCustomerId(created.id);
      setQuickCustomerName('');
      setShowQuickCustomer(false);
      notifyDataChanged();
    } catch (error: unknown) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      logger.error('Error al crear cliente rápido en checkout', normalized, { name: cleanName });
      setErrorMessage(
        error instanceof AppError ? error.message : 'No se pudo registrar el nuevo cliente.'
      );
    } finally {
      setIsCreatingCustomer(false);
    }
  };

  const handleSubmitSale = async (): Promise<void> => {
    if (product === null || isSubmitting) {
      return;
    }

    setErrorMessage(null);

    if (parsedQty <= 0) {
      setErrorMessage(
        product.unitType === 'GRAM'
          ? 'Ingresá una cantidad de gramos mayor a cero.'
          : 'Ingresá una cantidad de unidades mayor a cero.'
      );
      return;
    }

    if (parsedQty > product.stockQty) {
      setErrorMessage(
        `Stock insuficiente. Disponible: ${formatStockQty(product.stockQty, product.unitType)}.`
      );
      return;
    }

    if (paymentType !== 'CASH' && selectedCustomerId === null) {
      setErrorMessage('Seleccioná o creá un cliente para registrar el fiado.');
      return;
    }

    let paidCents = 0;
    if (paymentType === 'CASH') {
      paidCents = subtotalCents;
    } else if (paymentType === 'MIXED') {
      try {
        paidCents = parseCurrencyToCents(partialPaidInput);
      } catch (error: unknown) {
        setErrorMessage(
          error instanceof AppError ? error.message : 'Ingresá un monto de adelanto válido.'
        );
        return;
      }
      if (paidCents <= 0 || paidCents >= subtotalCents) {
        setErrorMessage('El adelanto debe ser mayor a USD$ 0 y menor al total de la venta.');
        return;
      }
    }

    setIsSubmitting(true);

    try {
      await services.registerSaleUseCase.execute({
        customerId: paymentType === 'CASH' ? null : selectedCustomerId,
        paymentType,
        paidCents,
        items: [{ productId: product.id, quantity: parsedQty, saleTier }],
      });

      notifyDataChanged();
      router.back();
    } catch (error: unknown) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      logger.error('Error al registrar operación desde checkout rápido', normalized, {
        productId: product.id,
        paymentType,
        saleTier,
      });
      setErrorMessage(
        error instanceof AppError ? error.message : 'No se pudo completar la operación.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <AgendaPaperBackground>
        <SafeAreaView style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </SafeAreaView>
      </AgendaPaperBackground>
    );
  }

  if (product === null) {
    return (
      <AgendaPaperBackground>
        <SafeAreaView style={styles.centered}>
          <ErrorBanner message={errorMessage ?? 'Producto no disponible.'} />
        </SafeAreaView>
      </AgendaPaperBackground>
    );
  }

  const parsedVisual = parseProductVisual(product.imageUri);
  const resolvedImageUri =
    parsedVisual.kind === 'IMAGE'
      ? services.imageStorageService.resolveImageUri(parsedVisual.fileName)
      : null;
  const isOutOfStock = product.stockQty === 0;
  const exceedsStock = parsedQty > product.stockQty;

  return (
    <AgendaPaperBackground>
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <KeyboardAvoidingView
          style={styles.flexOne}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <ErrorBanner message={errorMessage} />

            <View style={styles.productCard}>
              <View style={styles.thumbBox}>
                {parsedVisual.kind === 'EMOJI' ? (
                  <Text style={styles.thumbEmoji}>{parsedVisual.emoji}</Text>
                ) : resolvedImageUri !== null ? (
                  <Image source={{ uri: resolvedImageUri }} style={styles.thumbImage} />
                ) : (
                  <Ionicons
                    name={product.unitType === 'GRAM' ? 'scale-outline' : 'cube-outline'}
                    size={28}
                    color={Colors.primary}
                  />
                )}
              </View>
              <View style={styles.productInfo}>
                <Text style={styles.productName} numberOfLines={2}>
                  {product.name}
                </Text>
                <Text style={styles.productPrice}>
                  {formatPriceLabel(
                    effectiveUnitPriceCents,
                    product.unitType,
                    product.priceBaseQty
                  )}
                </Text>
                <Text style={[styles.stockLabel, isOutOfStock && styles.stockLabelDanger]}>
                  Stock disponible: {formatStockQty(product.stockQty, product.unitType)}
                </Text>
              </View>
            </View>

            {isOutOfStock && (
              <ErrorBanner message="Sin stock disponible. Tocá el lápiz del producto en el catálogo para reponer." />
            )}

            {/* Tarifa Minoreo / Mayoreo */}
            <View style={styles.bentoCard}>
              <Text style={styles.sectionKicker}>TIPO DE PRECIO</Text>
              <View style={styles.segmentedRow}>
                <Pressable
                  style={[styles.tierBtn, saleTier === 'RETAIL' && styles.tierBtnActive]}
                  onPress={() => setSaleTier('RETAIL')}
                >
                  <Text style={[styles.tierTitle, saleTier === 'RETAIL' && styles.tierTitleActive]}>
                    Minoreo
                  </Text>
                  <Text style={[styles.tierPrice, saleTier === 'RETAIL' && styles.tierPriceActive]}>
                    {formatPriceLabel(
                      product.unitPriceCents,
                      product.unitType,
                      product.priceBaseQty
                    )}
                  </Text>
                </Pressable>

                <Pressable
                  style={[styles.tierBtn, saleTier === 'WHOLESALE' && styles.tierBtnActive]}
                  onPress={() => setSaleTier('WHOLESALE')}
                >
                  <Text
                    style={[styles.tierTitle, saleTier === 'WHOLESALE' && styles.tierTitleActive]}
                  >
                    Mayoreo
                  </Text>
                  <Text
                    style={[styles.tierPrice, saleTier === 'WHOLESALE' && styles.tierPriceActive]}
                  >
                    {formatPriceLabel(
                      product.wholesalePriceCents,
                      product.unitType,
                      product.priceBaseQty
                    )}
                  </Text>
                </Pressable>
              </View>
            </View>

            {/* Selector de cantidad */}
            <View style={styles.bentoCard}>
              <Text style={styles.sectionKicker}>
                {product.unitType === 'GRAM' ? 'PESO A DESPACHAR (GRAMOS)' : 'CANTIDAD DE UNIDADES'}
              </Text>

              {product.unitType === 'GRAM' ? (
                <View style={styles.presetsGrid}>
                  {GRAM_PRESETS.map((preset) => {
                    const selected = parsedQty === preset.qty;
                    return (
                      <Pressable
                        key={preset.qty}
                        style={[styles.presetChip, selected && styles.presetChipActive]}
                        onPress={() => setQuantityInput(String(preset.qty))}
                      >
                        <Text
                          style={[styles.presetChipText, selected && styles.presetChipTextActive]}
                        >
                          {preset.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : (
                <View style={styles.unitControlsRow}>
                  <Pressable
                    style={styles.stepperBtn}
                    onPress={() => handleStepUnit(-1)}
                    accessibilityLabel="Restar una unidad"
                  >
                    <Ionicons name="remove" size={22} color={Colors.textPrimary} />
                  </Pressable>
                  <View style={styles.presetsInline}>
                    {UNIT_PRESETS.map((qty) => {
                      const selected = parsedQty === qty;
                      return (
                        <Pressable
                          key={qty}
                          style={[styles.miniPreset, selected && styles.presetChipActive]}
                          onPress={() => setQuantityInput(String(qty))}
                        >
                          <Text
                            style={[styles.presetChipText, selected && styles.presetChipTextActive]}
                          >
                            {qty}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Pressable
                    style={styles.stepperBtn}
                    onPress={() => handleStepUnit(1)}
                    accessibilityLabel="Sumar una unidad"
                  >
                    <Ionicons name="add" size={22} color={Colors.textPrimary} />
                  </Pressable>
                </View>
              )}

              <View style={styles.manualRow}>
                <Text style={styles.label}>
                  {product.unitType === 'GRAM' ? 'Ingreso manual (g)' : 'Ingreso manual (u.)'}
                </Text>
                <TextInput
                  style={[styles.qtyInput, exceedsStock && styles.qtyInputError]}
                  value={quantityInput}
                  onChangeText={handleQtyChange}
                  onFocus={() => {
                    if (quantityInput.trim() === '0') {
                      setQuantityInput('');
                    }
                  }}
                  selectTextOnFocus
                  keyboardType="number-pad"
                  placeholder="0"
                  placeholderTextColor={Colors.textMuted}
                />
              </View>
            </View>

            {/* Modalidad de cobro */}
            <View style={styles.bentoCard}>
              <Text style={styles.sectionKicker}>MODALIDAD DE PAGO</Text>
              <View style={styles.segmentedRow}>
                {(
                  [
                    { id: 'CREDIT', label: 'Fiado', icon: 'bookmark-outline' },
                    { id: 'CASH', label: 'Contado', icon: 'cash-outline' },
                    { id: 'MIXED', label: 'Mixto', icon: 'pie-chart-outline' },
                  ] as const
                ).map((mode) => {
                  const active = paymentType === mode.id;
                  return (
                    <Pressable
                      key={mode.id}
                      style={[styles.modeBtn, active && styles.modeBtnActive]}
                      onPress={() => setPaymentType(mode.id)}
                    >
                      <Ionicons
                        name={mode.icon}
                        size={16}
                        color={active ? Colors.white : Colors.textSecondary}
                      />
                      <Text style={[styles.modeBtnText, active && styles.modeBtnTextActive]}>
                        {mode.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {paymentType !== 'CASH' && (
                <View style={styles.customerSection}>
                  <View style={styles.customerHeader}>
                    <Text style={styles.label}>Cliente *</Text>
                    <Pressable
                      style={styles.quickAddBtn}
                      onPress={() => setShowQuickCustomer((prev) => !prev)}
                    >
                      <Ionicons name="person-add-outline" size={14} color={Colors.primary} />
                      <Text style={styles.quickAddText}>
                        {showQuickCustomer ? 'Cerrar' : 'Nuevo cliente'}
                      </Text>
                    </Pressable>
                  </View>

                  {showQuickCustomer && (
                    <View style={styles.quickFormRow}>
                      <TextInput
                        style={styles.quickInput}
                        value={quickCustomerName}
                        onChangeText={setQuickCustomerName}
                        placeholder="Nombre (ej: Juancito 4°B)"
                        placeholderTextColor={Colors.textMuted}
                      />
                      <Pressable
                        style={styles.quickSaveBtn}
                        onPress={() => void handleQuickCreateCustomer()}
                        disabled={isCreatingCustomer}
                      >
                        {isCreatingCustomer ? (
                          <ActivityIndicator color={Colors.white} size="small" />
                        ) : (
                          <Text style={styles.quickSaveText}>Crear</Text>
                        )}
                      </Pressable>
                    </View>
                  )}

                  {customers.length === 0 ? (
                    <Text style={styles.emptyCustomerHint}>
                      Todavía no hay clientes agendados. Tocá "Nuevo cliente" para cargarlo en 2
                      segundos.
                    </Text>
                  ) : (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.customerPills}
                    >
                      {customers.map((c) => {
                        const selected = selectedCustomerId === c.id;
                        return (
                          <Pressable
                            key={c.id}
                            style={[styles.customerPill, selected && styles.customerPillActive]}
                            onPress={() => setSelectedCustomerId(c.id)}
                          >
                            <Text
                              style={[
                                styles.customerPillText,
                                selected && styles.customerPillTextActive,
                              ]}
                            >
                              {c.fullName}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  )}
                </View>
              )}

              {paymentType === 'MIXED' && (
                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>Adelanto que paga ahora (USD$)</Text>
                  <TextInput
                    style={styles.input}
                    value={partialPaidInput}
                    onChangeText={setPartialPaidInput}
                    onFocus={() => {
                      if (partialPaidInput.trim() === '0') {
                        setPartialPaidInput('');
                      }
                    }}
                    selectTextOnFocus
                    placeholder="Ej: 5 o 2.50"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="decimal-pad"
                  />
                </View>
              )}
            </View>

            {/* Total y ganancia neta congelada */}
            <View style={styles.totalCard}>
              <View style={styles.totalTopRow}>
                <View>
                  <Text style={styles.totalKicker}>
                    {paymentType === 'CASH' ? 'TOTAL CONTADO' : 'PRECIO HISTÓRICO CONGELADO'}
                  </Text>
                  <Text style={styles.totalAmount}>{formatCentsToUSD(subtotalCents)}</Text>
                </View>
                <View style={styles.frozenTag}>
                  <Ionicons name="snow-outline" size={14} color={Colors.primaryLight} />
                  <Text style={styles.frozenTagText}>
                    {parsedQty > 0 ? formatStockQty(parsedQty, product.unitType) : '0'}
                  </Text>
                </View>
              </View>

              <View style={styles.profitStrip}>
                <Text style={styles.profitStripText}>
                  Costo: {formatCentsToUSD(costSubtotalCents)}
                </Text>
                <Text
                  style={[
                    styles.profitStripHighlight,
                    estimatedProfitCents < 0 && styles.profitStripLoss,
                  ]}
                >
                  Ganancia neta: {formatCentsToUSD(estimatedProfitCents)}
                </Text>
              </View>
            </View>

            <Pressable
              style={({ pressed }) => [
                styles.confirmBtn,
                (pressed || isSubmitting || isOutOfStock) && styles.confirmBtnDisabled,
              ]}
              onPress={() => void handleSubmitSale()}
              disabled={isSubmitting || isOutOfStock}
            >
              {isSubmitting ? (
                <ActivityIndicator color={Colors.white} />
              ) : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={20} color={Colors.white} />
                  <Text style={styles.confirmBtnText}>
                    {paymentType === 'CASH'
                      ? 'Confirmar venta'
                      : paymentType === 'CREDIT'
                        ? 'Anotar fiado'
                        : 'Confirmar pago mixto'}
                  </Text>
                </>
              )}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </AgendaPaperBackground>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  flexOne: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
    backgroundColor: 'transparent',
  },
  scrollContent: {
    padding: Spacing.lg,
    gap: Spacing.md,
    paddingBottom: Spacing.xxl,
  },
  productCard: {
    flexDirection: 'row',
    gap: Spacing.md,
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.card,
  },
  thumbBox: {
    width: 72,
    height: 72,
    borderRadius: Radius.lg,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  thumbEmoji: {
    fontSize: 38,
  },
  productInfo: {
    flex: 1,
    gap: 3,
  },
  productName: {
    fontSize: Typography.subtitle,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  productPrice: {
    fontSize: Typography.body,
    fontWeight: '800',
    color: Colors.primary,
  },
  stockLabel: {
    fontSize: Typography.caption,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  stockLabelDanger: {
    color: Colors.danger,
  },
  bentoCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    gap: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.card,
  },
  sectionKicker: {
    fontSize: Typography.micro,
    fontWeight: '800',
    color: Colors.primary,
    letterSpacing: 1,
  },
  tierBtn: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
    alignItems: 'center',
    gap: 2,
  },
  tierBtnActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  tierTitle: {
    fontSize: Typography.caption,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  tierTitleActive: {
    color: Colors.white,
  },
  tierPrice: {
    fontSize: Typography.micro,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  tierPriceActive: {
    color: Colors.primarySoft,
  },
  presetsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  presetChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    borderRadius: Radius.full,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  presetChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  presetChipText: {
    fontSize: Typography.caption,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  presetChipTextActive: {
    color: Colors.white,
  },
  unitControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  stepperBtn: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetsInline: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  miniPreset: {
    minWidth: 36,
    height: 36,
    borderRadius: Radius.full,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  manualRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  label: {
    fontSize: Typography.caption,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  qtyInput: {
    width: 120,
    textAlign: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingVertical: 10,
    paddingHorizontal: Spacing.md,
    fontSize: Typography.subtitle,
    fontWeight: '800',
    color: Colors.textPrimary,
    backgroundColor: Colors.background,
  },
  qtyInputError: {
    borderColor: Colors.danger,
    backgroundColor: Colors.dangerSoft,
  },
  segmentedRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  modeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 12,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  modeBtnActive: {
    backgroundColor: Colors.textPrimary,
    borderColor: Colors.textPrimary,
  },
  modeBtnText: {
    fontSize: Typography.caption,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  modeBtnTextActive: {
    color: Colors.white,
  },
  customerSection: {
    gap: Spacing.sm,
  },
  customerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  quickAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.full,
    backgroundColor: Colors.primarySoft,
  },
  quickAddText: {
    fontSize: Typography.micro,
    fontWeight: '700',
    color: Colors.primary,
  },
  quickFormRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  quickInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    fontSize: Typography.body,
    color: Colors.textPrimary,
    backgroundColor: Colors.background,
  },
  quickSaveBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickSaveText: {
    color: Colors.white,
    fontSize: Typography.caption,
    fontWeight: '700',
  },
  emptyCustomerHint: {
    fontSize: Typography.caption,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  customerPills: {
    gap: Spacing.sm,
    paddingVertical: 2,
  },
  customerPill: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: 10,
    borderRadius: Radius.full,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  customerPillActive: {
    backgroundColor: Colors.primarySoft,
    borderColor: Colors.primary,
  },
  customerPillText: {
    fontSize: Typography.caption,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  customerPillTextActive: {
    color: Colors.primary,
  },
  fieldGroup: {
    gap: Spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    fontSize: Typography.body,
    color: Colors.textPrimary,
    backgroundColor: Colors.background,
  },
  totalCard: {
    backgroundColor: Colors.vaultBackground,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.vaultBorderHighlight,
    ...Shadows.floating,
  },
  totalTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  totalKicker: {
    fontSize: 10,
    fontWeight: '800',
    color: Colors.vaultTextSecondary,
    letterSpacing: 1,
  },
  totalAmount: {
    fontSize: Typography.hero,
    fontWeight: '800',
    color: Colors.gold,
    marginTop: 2,
  },
  frozenTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.vaultSurface,
    borderWidth: 1,
    borderColor: Colors.vaultBorderHighlight,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: Radius.full,
  },
  frozenTagText: {
    color: Colors.vaultTextPrimary,
    fontSize: Typography.caption,
    fontWeight: '700',
  },
  profitStrip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.vaultBorder,
  },
  profitStripText: {
    fontSize: Typography.caption,
    color: Colors.vaultTextSecondary,
    fontWeight: '600',
  },
  profitStripHighlight: {
    fontSize: Typography.caption,
    color: Colors.primaryLight,
    fontWeight: '800',
  },
  profitStripLoss: {
    color: '#FCA5A5',
  },
  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    minHeight: 54,
    paddingVertical: 15,
    ...Shadows.glowPrimary,
  },
  confirmBtnDisabled: {
    opacity: 0.55,
  },
  confirmBtnText: {
    color: Colors.white,
    fontSize: Typography.body,
    fontWeight: '700',
  },
});