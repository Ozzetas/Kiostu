import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppError } from '../../src/core/errors/AppError';
import { Logger } from '../../src/core/logging/Logger';
import { formatCentsToUSD } from '../../src/core/utils/money';
import { formatStockQty } from '../../src/core/utils/units';
import { PaymentType, Product, SaleWithItems } from '../../src/domain/entities/types';
import { AgendaPaperBackground } from '../../src/presentation/components/AgendaPaperBackground';
import { ErrorBanner } from '../../src/presentation/components/ErrorBanner';
import { ProductTile } from '../../src/presentation/components/ProductTile';
import { useSecuritySession } from '../../src/presentation/components/SecurityGate';
import { useAppServices } from '../../src/presentation/di/AppServicesProvider';
import { useCatalog } from '../../src/presentation/hooks/useCatalog';
import { useFinancialSummary } from '../../src/presentation/hooks/useFinancialSummary';
import { Colors, Radius, Shadows, Spacing, Typography } from '../../src/presentation/theme/tokens';

const logger = new Logger('CatalogScreen');

function formatSaleDate(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return isoDate;
  }
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function getPaymentLabel(paymentType: PaymentType): string {
  switch (paymentType) {
    case 'CASH':
      return 'CONTADO';
    case 'CREDIT':
      return 'FIADO';
    case 'MIXED':
      return 'MIXTO';
  }
}

export default function CatalogScreen() {
  const router = useRouter();
  const { services, notifyDataChanged } = useAppServices();
  const { lockNow } = useSecuritySession();

  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Modal de nueva categoría
  const [categoryModalVisible, setCategoryModalVisible] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [isSavingCategory, setIsSavingCategory] = useState(false);

  // Modal de balance y rentabilidad detallada
  const [profitModalVisible, setProfitModalVisible] = useState(false);

  // Modal de historial general de ventas
  const [historyModalVisible, setHistoryModalVisible] = useState(false);
  const [recentSales, setRecentSales] = useState<readonly SaleWithItems[]>([]);
  const [customerNamesById, setCustomerNamesById] = useState<ReadonlyMap<string, string>>(
    new Map()
  );
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const { categories, products, isLoading, errorMessage, refresh } = useCatalog(selectedCategoryId);
  const {
    summary,
    isLoading: isLoadingSummary,
    errorMessage: summaryError,
    refresh: refreshSummary,
  } = useFinancialSummary();

  const filteredProducts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (query.length === 0) {
      return products;
    }
    return products.filter((item) => item.name.toLowerCase().includes(query));
  }, [products, searchQuery]);

  const lowStockCount = useMemo(
    () => products.filter((item) => item.stockQty <= item.minStockAlert).length,
    [products]
  );

  const globalMarginPct = useMemo(() => {
    if (summary.totalCostCents <= 0) {
      return null;
    }
    const totalProfit = summary.totalBilledCents - summary.totalCostCents;
    return Math.round((totalProfit / summary.totalCostCents) * 100);
  }, [summary]);

  const handleRefreshAll = async (): Promise<void> => {
    await Promise.all([refresh(), refreshSummary()]);
  };

  const loadRecentSales = useCallback(async (): Promise<void> => {
    setIsLoadingHistory(true);
    setHistoryError(null);
    try {
      const [sales, customers] = await Promise.all([
        services.saleRepository.listRecentSales(50),
        services.customerRepository.listActiveCustomers(),
      ]);
      setRecentSales(sales);
      setCustomerNamesById(new Map(customers.map((c) => [c.id, c.fullName])));
    } catch (error: unknown) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      logger.error('Error al cargar historial reciente de ventas', normalized);
      setHistoryError(
        error instanceof AppError ? error.message : 'No se pudo cargar el historial de ventas.'
      );
    } finally {
      setIsLoadingHistory(false);
    }
  }, [services]);

  const handleOpenHistory = (): void => {
    setHistoryModalVisible(true);
    void loadRecentSales();
  };

  const handleConfirmVoidSale = (sale: SaleWithItems): void => {
    Alert.alert(
      'Anular venta',
      `¿Anular esta operación por ${formatCentsToUSD(sale.totalCents)}? El stock se reintegrará automáticamente.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Anular venta',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await services.saleRepository.voidSaleAtomic(
                  sale.id,
                  'Anulada desde historial general'
                );
                notifyDataChanged();
                await loadRecentSales();
              } catch (error: unknown) {
                const normalized = error instanceof Error ? error : new Error(String(error));
                logger.error('Error al anular venta desde historial general', normalized, {
                  saleId: sale.id,
                });
                setHistoryError(
                  error instanceof AppError ? error.message : 'No se pudo anular la venta.'
                );
              }
            })();
          },
        },
      ]
    );
  };

  const handleOpenCreateProduct = (): void => {
    router.push('/modals/product-form');
  };

  const handleOpenCheckout = (product: Product): void => {
    router.push({
      pathname: '/modals/checkout-weight',
      params: { productId: product.id },
    });
  };

  const handleOpenEditProduct = (product: Product): void => {
    router.push({
      pathname: '/modals/product-form',
      params: { productId: product.id },
    });
  };

  const handleCreateCategory = async (): Promise<void> => {
    const trimmed = newCategoryName.trim();
    if (trimmed.length === 0) {
      setCategoryError('Ingresá un nombre para la categoría.');
      return;
    }

    setCategoryError(null);
    setIsSavingCategory(true);

    try {
      const created = await services.productRepository.createCategory({ name: trimmed });
      setNewCategoryName('');
      setCategoryModalVisible(false);
      setSelectedCategoryId(created.id);
      notifyDataChanged();
    } catch (error: unknown) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      logger.error('Error al crear categoría desde Catálogo', normalized, { name: trimmed });
      setCategoryError(
        error instanceof AppError
          ? error.message
          : 'No se pudo crear la categoría (verificá que no esté duplicada).'
      );
    } finally {
      setIsSavingCategory(false);
    }
  };

  return (
    <AgendaPaperBackground>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.container}>
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.kicker}>AGENDA LOCAL · USD$</Text>
              <Text style={styles.title}>Mi Kiosco</Text>
            </View>
            <View style={styles.headerActions}>
              <Pressable
                style={({ pressed }) => [
                  styles.headerIconBtn,
                  pressed && styles.headerIconBtnPressed,
                ]}
                onPress={handleOpenHistory}
                accessibilityLabel="Historial de ventas"
              >
                <Ionicons name="receipt-outline" size={20} color={Colors.textPrimary} />
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.headerIconBtn,
                  pressed && styles.headerIconBtnPressed,
                ]}
                onPress={lockNow}
                accessibilityLabel="Cerrar agenda"
              >
                <Ionicons name="lock-closed-outline" size={20} color={Colors.textPrimary} />
              </Pressable>
            </View>
          </View>

          {/* Módulos financieros principales: Total a cobrar + Ganancia Neta */}
          <View style={styles.kpiRow}>
            <Pressable
              style={({ pressed }) => [
                styles.financeCard,
                pressed && styles.financeCardPressed,
              ]}
              onPress={() => router.push('/(tabs)/customers')}
            >
              <View style={styles.financeTopRow}>
                <Text style={styles.financeLabel}>TOTAL A COBRAR</Text>
                <Ionicons name="chevron-forward" size={14} color={Colors.vaultTextSecondary} />
              </View>
              <Text style={styles.financeValueGold} numberOfLines={1} adjustsFontSizeToFit>
                {formatCentsToUSD(summary.pendingDebtCents)}
              </Text>
              <Text style={styles.financeSubtext}>Deudas abiertas en fiados</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.financeCard,
                styles.financeCardProfit,
                pressed && styles.financeCardPressed,
              ]}
              onPress={() => setProfitModalVisible(true)}
            >
              <View style={styles.financeTopRow}>
                <Text style={styles.financeLabel}>GANANCIA NETA</Text>
                <Ionicons name="stats-chart" size={13} color={Colors.primaryLight} />
              </View>
              <Text
                style={[
                  styles.financeValueProfit,
                  summary.realizedNetProfitCents < 0 && styles.financeValueLoss,
                ]}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {formatCentsToUSD(summary.realizedNetProfitCents)}
              </Text>
              <Text style={styles.financeSubtext}>Ya cobrada · Ver desglose</Text>
            </Pressable>
          </View>

          {/* Resumen compacto de inventario */}
          <View style={styles.inventoryStrip}>
            <View style={styles.inventoryStat}>
              <Ionicons name="cube-outline" size={14} color={Colors.textSecondary} />
              <Text style={styles.inventoryStatText}>{products.length} productos</Text>
            </View>
            <View style={styles.inventoryDivider} />
            <View style={styles.inventoryStat}>
              <Ionicons
                name="warning-outline"
                size={14}
                color={lowStockCount > 0 ? Colors.warning : Colors.textSecondary}
              />
              <Text
                style={[
                  styles.inventoryStatText,
                  lowStockCount > 0 && styles.inventoryStatWarning,
                ]}
              >
                {lowStockCount} con stock bajo
              </Text>
            </View>
          </View>

          <View style={styles.searchBar}>
            <Ionicons name="search" size={18} color={Colors.textMuted} />
            <TextInput
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Buscar producto..."
              placeholderTextColor={Colors.textMuted}
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
              </Pressable>
            )}
          </View>

          <View style={styles.categoriesWrapper}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.categoriesContent}
            >
              <Pressable
                style={[
                  styles.categoryChip,
                  selectedCategoryId === null && styles.categoryChipActive,
                ]}
                onPress={() => setSelectedCategoryId(null)}
              >
                <Text
                  style={[
                    styles.categoryChipText,
                    selectedCategoryId === null && styles.categoryChipTextActive,
                  ]}
                >
                  Todas
                </Text>
              </Pressable>

              {categories.map((cat) => {
                const active = selectedCategoryId === cat.id;
                return (
                  <Pressable
                    key={cat.id}
                    style={[styles.categoryChip, active && styles.categoryChipActive]}
                    onPress={() => setSelectedCategoryId(cat.id)}
                  >
                    <Text
                      style={[styles.categoryChipText, active && styles.categoryChipTextActive]}
                    >
                      {cat.name}
                    </Text>
                  </Pressable>
                );
              })}

              <Pressable
                style={styles.addCategoryChip}
                onPress={() => {
                  setCategoryError(null);
                  setNewCategoryName('');
                  setCategoryModalVisible(true);
                }}
              >
                <Ionicons name="add" size={16} color={Colors.primary} />
                <Text style={styles.addCategoryText}>Categoría</Text>
              </Pressable>
            </ScrollView>
          </View>

          <ErrorBanner message={errorMessage ?? summaryError} />

          <FlatList
            data={filteredProducts}
            keyExtractor={(item) => item.id}
            numColumns={2}
            columnWrapperStyle={styles.gridRow}
            contentContainerStyle={styles.gridContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={isLoading || isLoadingSummary}
                onRefresh={() => void handleRefreshAll()}
                tintColor={Colors.primary}
              />
            }
            renderItem={({ item }) => (
              <ProductTile
                product={item}
                resolvedImageUri={services.imageStorageService.resolveImageUri(item.imageUri)}
                onPress={handleOpenCheckout}
                onEditPress={handleOpenEditProduct}
              />
            )}
            ListEmptyComponent={
              <View style={styles.emptyCard}>
                <View style={styles.emptyIconCircle}>
                  <Ionicons name="sparkles-outline" size={28} color={Colors.primary} />
                </View>
                <Text style={styles.emptyTitle}>
                  {searchQuery.trim().length > 0
                    ? 'Sin resultados'
                    : 'Tu agenda está lista para empezar'}
                </Text>
                <Text style={styles.emptySubtitle}>
                  {searchQuery.trim().length > 0
                    ? 'Probá con otro nombre o quitá el filtro de categoría.'
                    : 'Cargá tu primer producto con costo, precio mayoreo/minoreo y foto o emoji.'}
                </Text>
                {searchQuery.trim().length === 0 && (
                  <Pressable
                    style={({ pressed }) => [styles.emptyCta, pressed && styles.emptyCtaPressed]}
                    onPress={handleOpenCreateProduct}
                  >
                    <Ionicons name="add-circle-outline" size={18} color={Colors.white} />
                    <Text style={styles.emptyCtaText}>Crear primer producto</Text>
                  </Pressable>
                )}
              </View>
            }
          />

          <Pressable
            style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
            onPress={handleOpenCreateProduct}
          >
            <Ionicons name="add" size={24} color={Colors.white} />
            <Text style={styles.fabText}>Producto</Text>
          </Pressable>
        </View>

        {/* Modal de Balance y Rentabilidad Detallada */}
        <Modal
          visible={profitModalVisible}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setProfitModalVisible(false)}
        >
          <AgendaPaperBackground>
            <SafeAreaView style={styles.historySafeArea} edges={['top', 'bottom']}>
              <View style={styles.historyHeader}>
                <View>
                  <Text style={styles.kicker}>RENDIMIENTO DEL NEGOCIO</Text>
                  <Text style={styles.historyTitle}>Ganancias y Balance</Text>
                </View>
                <Pressable
                  style={styles.closeHistoryBtn}
                  onPress={() => setProfitModalVisible(false)}
                >
                  <Ionicons name="close" size={20} color={Colors.textPrimary} />
                </Pressable>
              </View>

              <ScrollView contentContainerStyle={styles.historyScroll}>
                <View style={styles.profitHeroCard}>
                  <Text style={styles.financeLabel}>GANANCIA NETA YA COBRADA</Text>
                  <Text style={styles.profitHeroAmount}>
                    {formatCentsToUSD(summary.realizedNetProfitCents)}
                  </Text>
                  <Text style={styles.profitHeroCaption}>
                    Es tu ganancia limpia real (venta menos costo) de todo lo que ya cobraste al
                    contado y en pagos de deudas.
                  </Text>
                </View>

                <View style={styles.breakdownCard}>
                  <Text style={styles.sectionKicker}>DESGLOSE DE CAJA</Text>

                  <View style={styles.metricRow}>
                    <View style={styles.metricLabelGroup}>
                      <Text style={styles.metricTitle}>Dinero cobrado en mano</Text>
                      <Text style={styles.metricHint}>Contado + adelantos + cobros de fiados</Text>
                    </View>
                    <Text style={styles.metricValue}>
                      {formatCentsToUSD(summary.totalCollectedCents)}
                    </Text>
                  </View>

                  <View style={styles.metricSeparator} />

                  <View style={styles.metricRow}>
                    <View style={styles.metricLabelGroup}>
                      <Text style={styles.metricTitle}>Total pendiente por cobrar</Text>
                      <Text style={styles.metricHint}>Deudas abiertas de tus clientes</Text>
                    </View>
                    <Text style={styles.metricValueWarning}>
                      {formatCentsToUSD(summary.pendingDebtCents)}
                    </Text>
                  </View>

                  <View style={styles.metricSeparator} />

                  <View style={styles.metricRow}>
                    <View style={styles.metricLabelGroup}>
                      <Text style={styles.metricTitle}>Ganancia pendiente en fiados</Text>
                      <Text style={styles.metricHint}>
                        Se suma a tu Ganancia Neta a medida que cobres
                      </Text>
                    </View>
                    <Text style={styles.metricValuePrimary}>
                      {formatCentsToUSD(summary.pendingNetProfitCents)}
                    </Text>
                  </View>
                </View>

                <View style={styles.breakdownCard}>
                  <Text style={styles.sectionKicker}>FACTURACIÓN VS. COSTOS</Text>

                  <View style={styles.metricRow}>
                    <View style={styles.metricLabelGroup}>
                      <Text style={styles.metricTitle}>Total facturado (ventas activas)</Text>
                      <Text style={styles.metricHint}>Suma de ventas no anuladas</Text>
                    </View>
                    <Text style={styles.metricValue}>
                      {formatCentsToUSD(summary.totalBilledCents)}
                    </Text>
                  </View>

                  <View style={styles.metricSeparator} />

                  <View style={styles.metricRow}>
                    <View style={styles.metricLabelGroup}>
                      <Text style={styles.metricTitle}>Costo de mercadería vendida</Text>
                      <Text style={styles.metricHint}>
                        Según el costo cargado en cada producto al vender
                      </Text>
                    </View>
                    <Text style={styles.metricValue}>
                      {formatCentsToUSD(summary.totalCostCents)}
                    </Text>
                  </View>

                  {globalMarginPct !== null && (
                    <>
                      <View style={styles.metricSeparator} />
                      <View style={styles.metricRow}>
                        <View style={styles.metricLabelGroup}>
                          <Text style={styles.metricTitle}>Margen promedio sobre costo</Text>
                          <Text style={styles.metricHint}>Rentabilidad global acumulada</Text>
                        </View>
                        <Text style={styles.metricValuePrimary}>
                          {globalMarginPct >= 0 ? `+${globalMarginPct}%` : `${globalMarginPct}%`}
                        </Text>
                      </View>
                    </>
                  )}
                </View>
              </ScrollView>
            </SafeAreaView>
          </AgendaPaperBackground>
        </Modal>

        {/* Modal de nueva categoría */}
        <Modal
          visible={categoryModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setCategoryModalVisible(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Nueva categoría</Text>
              <ErrorBanner message={categoryError} />
              <TextInput
                style={styles.modalInput}
                value={newCategoryName}
                onChangeText={setNewCategoryName}
                placeholder="Ej: Fiambrería, Alfombras, Relojes..."
                placeholderTextColor={Colors.textMuted}
                autoFocus
              />
              <View style={styles.modalActions}>
                <Pressable
                  style={styles.modalCancelBtn}
                  onPress={() => setCategoryModalVisible(false)}
                  disabled={isSavingCategory}
                >
                  <Text style={styles.modalCancelText}>Cancelar</Text>
                </Pressable>
                <Pressable
                  style={styles.modalSaveBtn}
                  onPress={() => void handleCreateCategory()}
                  disabled={isSavingCategory}
                >
                  {isSavingCategory ? (
                    <ActivityIndicator color={Colors.white} size="small" />
                  ) : (
                    <Text style={styles.modalSaveText}>Guardar</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        {/* Modal de historial general de ventas (Contado, Fiado y Mixto) */}
        <Modal
          visible={historyModalVisible}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setHistoryModalVisible(false)}
        >
          <AgendaPaperBackground>
            <SafeAreaView style={styles.historySafeArea} edges={['top', 'bottom']}>
              <View style={styles.historyHeader}>
                <View>
                  <Text style={styles.kicker}>MOVIMIENTOS RECIENTES</Text>
                  <Text style={styles.historyTitle}>Historial de ventas</Text>
                </View>
                <Pressable
                  style={styles.closeHistoryBtn}
                  onPress={() => setHistoryModalVisible(false)}
                >
                  <Ionicons name="close" size={20} color={Colors.textPrimary} />
                </Pressable>
              </View>

              <ScrollView contentContainerStyle={styles.historyScroll}>
                <ErrorBanner message={historyError} />

                {isLoadingHistory ? (
                  <ActivityIndicator color={Colors.primary} style={styles.historyLoader} />
                ) : recentSales.length === 0 ? (
                  <View style={styles.emptyCard}>
                    <Ionicons name="receipt-outline" size={30} color={Colors.primary} />
                    <Text style={styles.emptyTitle}>Sin ventas registradas</Text>
                    <Text style={styles.emptySubtitle}>
                      Tocá cualquier producto del catálogo para registrar una venta contado o un
                      fiado.
                    </Text>
                  </View>
                ) : (
                  recentSales.map((sale) => {
                    const isVoided = sale.status === 'VOIDED';
                    const customerLabel =
                      sale.customerId !== null
                        ? (customerNamesById.get(sale.customerId) ?? 'Cliente')
                        : 'Venta al contado';
                    const saleCostCents = sale.items.reduce(
                      (acc, item) => acc + item.costSubtotalCents,
                      0
                    );
                    const saleProfitCents = sale.totalCents - saleCostCents;

                    return (
                      <View
                        key={sale.id}
                        style={[styles.saleCard, isVoided && styles.saleCardVoided]}
                      >
                        <View style={styles.saleTopRow}>
                          <Text style={styles.saleDate}>{formatSaleDate(sale.createdAt)}</Text>
                          <View style={styles.saleBadges}>
                            <View style={styles.modeBadge}>
                              <Text style={styles.modeBadgeText}>
                                {getPaymentLabel(sale.paymentType)}
                              </Text>
                            </View>
                            {isVoided && (
                              <View style={styles.voidedBadge}>
                                <Text style={styles.voidedBadgeText}>ANULADA</Text>
                              </View>
                            )}
                          </View>
                        </View>

                        <Text style={styles.saleCustomer}>{customerLabel}</Text>

                        {sale.items.map((item) => (
                          <View key={item.id} style={styles.saleItemRow}>
                            <Text style={styles.saleItemName}>
                              {formatStockQty(item.quantity, item.unitTypeSnapshot)} ·{' '}
                              {item.productNameSnapshot}
                              {item.saleTier === 'WHOLESALE' ? ' (Mayoreo)' : ''}
                            </Text>
                            <Text style={styles.saleItemPrice}>
                              {formatCentsToUSD(item.subtotalCents)}
                            </Text>
                          </View>
                        ))}

                        <View style={styles.saleBottomRow}>
                          <View>
                            <Text style={styles.saleTotalText}>
                              Total: {formatCentsToUSD(sale.totalCents)}
                            </Text>
                            {!isVoided && (
                              <Text style={styles.saleProfitText}>
                                Ganancia: {formatCentsToUSD(saleProfitCents)}
                              </Text>
                            )}
                          </View>
                          {!isVoided && sale.directPaidCents === 0 && (
                            <Pressable
                              style={styles.voidSaleBtn}
                              onPress={() => handleConfirmVoidSale(sale)}
                            >
                              <Ionicons
                                name="close-circle-outline"
                                size={16}
                                color={Colors.danger}
                              />
                              <Text style={styles.voidSaleBtnText}>Anular venta</Text>
                            </Pressable>
                          )}
                        </View>
                      </View>
                    );
                  })
                )}
              </ScrollView>
            </SafeAreaView>
          </AgendaPaperBackground>
        </Modal>
      </SafeAreaView>
    </AgendaPaperBackground>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  container: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.xs,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  kicker: {
    fontSize: Typography.micro,
    fontWeight: '800',
    color: Colors.primary,
    letterSpacing: 1.2,
  },
  title: {
    fontSize: Typography.hero,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: -0.6,
  },
  headerIconBtn: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadows.card,
  },
  headerIconBtnPressed: {
    backgroundColor: Colors.primarySoft,
  },
  kpiRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  financeCard: {
    flex: 1,
    backgroundColor: Colors.vaultBackground,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.vaultBorderHighlight,
    gap: 3,
    ...Shadows.card,
  },
  financeCardProfit: {
    borderColor: 'rgba(16, 185, 129, 0.45)',
  },
  financeCardPressed: {
    opacity: 0.88,
  },
  financeTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  financeLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: Colors.vaultTextSecondary,
    letterSpacing: 0.8,
  },
  financeValueGold: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.gold,
  },
  financeValueProfit: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.primaryLight,
  },
  financeValueLoss: {
    color: '#FCA5A5',
  },
  financeSubtext: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.vaultTextMuted,
  },
  inventoryStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    backgroundColor: Colors.surface,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 7,
    paddingHorizontal: Spacing.md,
  },
  inventoryStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  inventoryStatText: {
    fontSize: Typography.caption,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  inventoryStatWarning: {
    color: Colors.warning,
  },
  inventoryDivider: {
    width: 1,
    height: 14,
    backgroundColor: Colors.border,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.lg,
    height: 44,
  },
  searchInput: {
    flex: 1,
    fontSize: Typography.body,
    color: Colors.textPrimary,
  },
  categoriesWrapper: {
    height: 40,
  },
  categoriesContent: {
    alignItems: 'center',
    gap: Spacing.sm,
    paddingRight: Spacing.lg,
  },
  categoryChip: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: 8,
    borderRadius: Radius.full,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  categoryChipActive: {
    backgroundColor: Colors.textPrimary,
    borderColor: Colors.textPrimary,
  },
  categoryChipText: {
    fontSize: Typography.caption,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  categoryChipTextActive: {
    color: Colors.white,
    fontWeight: '700',
  },
  addCategoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: Radius.full,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: Colors.primaryLight,
  },
  addCategoryText: {
    fontSize: Typography.caption,
    fontWeight: '700',
    color: Colors.primary,
  },
  gridContent: {
    paddingBottom: 96,
    gap: Spacing.md,
  },
  gridRow: {
    gap: Spacing.md,
  },
  emptyCard: {
    marginTop: Spacing.xl,
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    alignItems: 'center',
    gap: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.card,
  },
  emptyIconCircle: {
    width: 60,
    height: 60,
    borderRadius: Radius.full,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontSize: Typography.subtitle,
    fontWeight: '700',
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: Typography.body,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 21,
  },
  emptyCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.xl,
    paddingVertical: 14,
    borderRadius: Radius.full,
    marginTop: Spacing.xs,
    ...Shadows.glowPrimary,
  },
  emptyCtaPressed: {
    backgroundColor: Colors.primaryPressed,
  },
  emptyCtaText: {
    color: Colors.white,
    fontSize: Typography.body,
    fontWeight: '700',
  },
  fab: {
    position: 'absolute',
    right: Spacing.lg,
    bottom: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.xl,
    paddingVertical: 14,
    borderRadius: Radius.full,
    ...Shadows.glowPrimary,
  },
  fabPressed: {
    backgroundColor: Colors.primaryPressed,
  },
  fabText: {
    color: Colors.white,
    fontSize: Typography.body,
    fontWeight: '700',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(7, 11, 10, 0.58)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  modalCard: {
    width: '100%',
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.md,
    ...Shadows.floating,
  },
  modalTitle: {
    fontSize: Typography.subtitle,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    fontSize: Typography.body,
    color: Colors.textPrimary,
    backgroundColor: Colors.background,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  modalCancelBtn: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: 12,
    borderRadius: Radius.md,
  },
  modalCancelText: {
    fontSize: Typography.body,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  modalSaveBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.xl,
    paddingVertical: 12,
    borderRadius: Radius.md,
    minWidth: 100,
    alignItems: 'center',
  },
  modalSaveText: {
    fontSize: Typography.body,
    fontWeight: '700',
    color: Colors.white,
  },
  historySafeArea: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  historyTitle: {
    fontSize: Typography.title,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  closeHistoryBtn: {
    width: 38,
    height: 38,
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyScroll: {
    padding: Spacing.lg,
    gap: Spacing.md,
    paddingBottom: Spacing.xxl,
  },
  historyLoader: {
    marginVertical: Spacing.xl,
  },
  profitHeroCard: {
    backgroundColor: Colors.vaultBackground,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.primaryLight,
    ...Shadows.floating,
  },
  profitHeroAmount: {
    fontSize: 34,
    fontWeight: '900',
    color: Colors.primaryLight,
  },
  profitHeroCaption: {
    fontSize: Typography.caption,
    color: Colors.vaultTextSecondary,
    lineHeight: 19,
    marginTop: Spacing.xs,
  },
  breakdownCard: {
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
  metricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  metricLabelGroup: {
    flex: 1,
    gap: 2,
  },
  metricTitle: {
    fontSize: Typography.body,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  metricHint: {
    fontSize: Typography.micro,
    color: Colors.textSecondary,
  },
  metricValue: {
    fontSize: Typography.body,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  metricValuePrimary: {
    fontSize: Typography.body,
    fontWeight: '800',
    color: Colors.primary,
  },
  metricValueWarning: {
    fontSize: Typography.body,
    fontWeight: '800',
    color: Colors.warning,
  },
  metricSeparator: {
    height: 1,
    backgroundColor: Colors.borderSubtle,
  },
  saleCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.card,
  },
  saleCardVoided: {
    opacity: 0.6,
  },
  saleTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  saleDate: {
    fontSize: Typography.caption,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  saleBadges: {
    flexDirection: 'row',
    gap: 6,
  },
  modeBadge: {
    backgroundColor: Colors.primarySoft,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.full,
  },
  modeBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: Colors.primary,
  },
  voidedBadge: {
    backgroundColor: Colors.dangerSoft,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.full,
  },
  voidedBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: Colors.danger,
  },
  saleCustomer: {
    fontSize: Typography.caption,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  saleItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  saleItemName: {
    flex: 1,
    fontSize: Typography.body,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  saleItemPrice: {
    fontSize: Typography.body,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  saleBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.borderSubtle,
  },
  saleTotalText: {
    fontSize: Typography.body,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  saleProfitText: {
    fontSize: Typography.micro,
    fontWeight: '700',
    color: Colors.primary,
  },
  voidSaleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.dangerSoft,
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
    borderRadius: Radius.full,
  },
  voidSaleBtnText: {
    fontSize: Typography.caption,
    fontWeight: '800',
    color: Colors.danger,
  },
});