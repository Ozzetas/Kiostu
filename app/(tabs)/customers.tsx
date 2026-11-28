import { Ionicons } from '@expo/vector-icons';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
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
import { formatCentsToUSD, parseCurrencyToCents } from '../../src/core/utils/money';
import { formatStockQty } from '../../src/core/utils/units';
import { Customer, CustomerPayment, SaleWithItems } from '../../src/domain/entities/types';
import { AgendaPaperBackground } from '../../src/presentation/components/AgendaPaperBackground';
import { ErrorBanner } from '../../src/presentation/components/ErrorBanner';
import { useAppServices } from '../../src/presentation/di/AppServicesProvider';
import { CustomerWithBalance, useCustomers } from '../../src/presentation/hooks/useCustomers';
import { Colors, Radius, Shadows, Spacing, Typography } from '../../src/presentation/theme/tokens';

const logger = new Logger('CustomersScreen');

function formatShortDate(isoDate: string): string {
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

export default function CustomersScreen() {
  const { services, notifyDataChanged } = useAppServices();
  const { items, totalDebtCents, debtorsCount, isLoading, errorMessage, refresh } = useCustomers();

  const [searchQuery, setSearchQuery] = useState('');
  const [onlyWithDebt, setOnlyWithDebt] = useState(false);

  // Modal de alta / edición de cliente
  const [formModalVisible, setFormModalVisible] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [formName, setFormName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSavingForm, setIsSavingForm] = useState(false);

  // Modal de ficha de cuenta corriente
  const [selectedEntry, setSelectedEntry] = useState<CustomerWithBalance | null>(null);
  const [detailTab, setDetailTab] = useState<'SALES' | 'PAYMENTS'>('SALES');
  const [customerSales, setCustomerSales] = useState<readonly SaleWithItems[]>([]);
  const [customerPayments, setCustomerPayments] = useState<readonly CustomerPayment[]>([]);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Pago parcial / total / por venta dentro de la ficha
  const [paymentAmountInput, setPaymentAmountInput] = useState('');
  const [paymentNotesInput, setPaymentNotesInput] = useState('');
  const [isRecordingPayment, setIsRecordingPayment] = useState(false);

  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return items.filter((entry) => {
      if (onlyWithDebt && entry.balance.currentDebtCents <= 0) {
        return false;
      }
      if (query.length === 0) {
        return true;
      }
      return (
        entry.customer.fullName.toLowerCase().includes(query) ||
        (entry.customer.notes?.toLowerCase().includes(query) ?? false)
      );
    });
  }, [items, searchQuery, onlyWithDebt]);

  const openCreateModal = (): void => {
    setEditingCustomer(null);
    setFormName('');
    setFormPhone('');
    setFormNotes('');
    setFormError(null);
    setFormModalVisible(true);
  };

  const openEditModal = (customer: Customer): void => {
    setEditingCustomer(customer);
    setFormName(customer.fullName);
    setFormPhone(customer.phone ?? '');
    setFormNotes(customer.notes ?? '');
    setFormError(null);
    setFormModalVisible(true);
  };

  const handleSaveCustomerForm = async (): Promise<void> => {
    const cleanName = formName.trim();
    if (cleanName.length === 0) {
      setFormError('El nombre del cliente es obligatorio.');
      return;
    }

    setFormError(null);
    setIsSavingForm(true);

    try {
      if (editingCustomer !== null) {
        const updated = await services.customerRepository.updateCustomer(editingCustomer.id, {
          fullName: cleanName,
          phone: formPhone.trim() || null,
          notes: formNotes.trim() || null,
        });
        if (selectedEntry?.customer.id === updated.id) {
          setSelectedEntry({ ...selectedEntry, customer: updated });
        }
      } else {
        await services.customerRepository.createCustomer({
          fullName: cleanName,
          phone: formPhone.trim() || null,
          notes: formNotes.trim() || null,
        });
      }

      setFormModalVisible(false);
      notifyDataChanged();
    } catch (error: unknown) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      logger.error('Error al guardar cliente', normalized);
      setFormError(error instanceof AppError ? error.message : 'No se pudo guardar el cliente.');
    } finally {
      setIsSavingForm(false);
    }
  };

  const loadCustomerLedger = useCallback(
    async (customerId: string): Promise<void> => {
      setIsLoadingDetail(true);
      setDetailError(null);
      try {
        const [freshCustomer, freshBalance, sales, payments] = await Promise.all([
          services.customerRepository.findById(customerId),
          services.customerRepository.getBalanceByCustomerId(customerId),
          services.saleRepository.listSalesByCustomer(customerId),
          services.customerRepository.listPaymentsByCustomer(customerId),
        ]);

        if (freshCustomer !== null) {
          setSelectedEntry({
            customer: freshCustomer,
            balance: freshBalance ?? {
              customerId: freshCustomer.id,
              fullName: freshCustomer.fullName,
              totalCreditedCents: 0,
              totalPaidCents: 0,
              currentDebtCents: 0,
            },
          });
        }
        setCustomerSales(sales);
        setCustomerPayments(payments);
      } catch (error: unknown) {
        const normalized = error instanceof Error ? error : new Error(String(error));
        logger.error('Error al cargar cuenta corriente del cliente', normalized, { customerId });
        setDetailError(
          error instanceof AppError ? error.message : 'No se pudo cargar el historial del cliente.'
        );
      } finally {
        setIsLoadingDetail(false);
      }
    },
    [services]
  );

  const handleOpenCustomerDetail = (entry: CustomerWithBalance): void => {
    setSelectedEntry(entry);
    setDetailTab('SALES');
    setPaymentAmountInput('');
    setPaymentNotesInput('');
    setDetailError(null);
    void loadCustomerLedger(entry.customer.id);
  };

  const executePayment = async (amountCents: number, notes?: string): Promise<void> => {
    if (selectedEntry === null || isRecordingPayment) {
      return;
    }

    setDetailError(null);
    setIsRecordingPayment(true);

    try {
      await services.recordPaymentUseCase.execute({
        customerId: selectedEntry.customer.id,
        amountCents,
        notes,
      });
      setPaymentAmountInput('');
      setPaymentNotesInput('');
      notifyDataChanged();
      await loadCustomerLedger(selectedEntry.customer.id);
    } catch (error: unknown) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      logger.error('Error al registrar pago de deuda', normalized, {
        customerId: selectedEntry.customer.id,
      });
      setDetailError(error instanceof AppError ? error.message : 'No se pudo registrar el pago.');
    } finally {
      setIsRecordingPayment(false);
    }
  };

  const handleRecordPartialPayment = async (): Promise<void> => {
    let amountCents: number;
    try {
      amountCents = parseCurrencyToCents(paymentAmountInput);
    } catch (error: unknown) {
      setDetailError(error instanceof AppError ? error.message : 'Monto de pago inválido.');
      return;
    }
    await executePayment(amountCents, paymentNotesInput.trim() || undefined);
  };

  const handleConfirmSettleAll = (): void => {
    if (selectedEntry === null || selectedEntry.balance.currentDebtCents <= 0) {
      return;
    }
    const debtCents = selectedEntry.balance.currentDebtCents;
    Alert.alert(
      'Saldar deuda total',
      `¿Confirmás el cobro total de ${formatCentsToUSD(debtCents)} para dejar a "${selectedEntry.customer.fullName}" al día?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Saldar todo',
          onPress: () => {
            void executePayment(
              debtCents,
              paymentNotesInput.trim() || 'Cancelación total de deuda'
            );
          },
        },
      ]
    );
  };

  const handleConfirmPaySingleSale = (sale: SaleWithItems, remainingSaleCents: number): void => {
    if (selectedEntry === null || isRecordingPayment) {
      return;
    }

    const itemsSummary = sale.items
      .map((item) => `${formatStockQty(item.quantity, item.unitTypeSnapshot)} · ${item.productNameSnapshot}`)
      .join(', ');

    Alert.alert(
      'Confirmar pago',
      `¿Confirmás que "${selectedEntry.customer.fullName}" pagó ${formatCentsToUSD(remainingSaleCents)} por ${itemsSummary}?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Confirmar pago',
          onPress: () => {
            void (async () => {
              setDetailError(null);
              setIsRecordingPayment(true);
              try {
                await services.saleRepository.paySaleAtomic(
                  sale.id,
                  `Pago puntual: ${itemsSummary}`
                );
                notifyDataChanged();
                await loadCustomerLedger(selectedEntry.customer.id);
              } catch (error: unknown) {
                const normalized = error instanceof Error ? error : new Error(String(error));
                logger.error('Error al cobrar venta individual', normalized, { saleId: sale.id });
                setDetailError(
                  error instanceof AppError
                    ? error.message
                    : 'No se pudo registrar el pago de esta venta.'
                );
              } finally {
                setIsRecordingPayment(false);
              }
            })();
          },
        },
      ]
    );
  };

  const handleConfirmVoidSale = (sale: SaleWithItems): void => {
    if (selectedEntry === null) {
      return;
    }

    Alert.alert(
      'Anular operación',
      `¿Anular esta venta por ${formatCentsToUSD(sale.totalCents)}? El stock se reintegrará automáticamente y se descontará de la deuda.`,
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
                  'Anulada desde cuenta corriente'
                );
                notifyDataChanged();
                await loadCustomerLedger(selectedEntry.customer.id);
              } catch (error: unknown) {
                const normalized = error instanceof Error ? error : new Error(String(error));
                logger.error('Error al anular venta desde ficha de cliente', normalized, {
                  saleId: sale.id,
                });
                setDetailError(
                  error instanceof AppError ? error.message : 'No se pudo anular la venta.'
                );
              }
            })();
          },
        },
      ]
    );
  };

  const handleConfirmDeleteCustomer = (): void => {
    if (selectedEntry === null) {
      return;
    }

    Alert.alert(
      'Eliminar cliente',
      `¿Querés quitar a "${selectedEntry.customer.fullName}" de tu agenda? Solo es posible si su saldo está en USD$ 0.00.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await services.customerRepository.softDeleteCustomer(selectedEntry.customer.id);
                setSelectedEntry(null);
                notifyDataChanged();
              } catch (error: unknown) {
                const normalized = error instanceof Error ? error : new Error(String(error));
                logger.error('Error al desactivar cliente', normalized, {
                  customerId: selectedEntry.customer.id,
                });
                setDetailError(
                  error instanceof AppError ? error.message : 'No se pudo eliminar el cliente.'
                );
              }
            })();
          },
        },
      ]
    );
  };

  return (
    <AgendaPaperBackground>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.container}>
          <View>
            <Text style={styles.kicker}>CUENTAS CORRIENTES · USD$</Text>
            <Text style={styles.title}>Fiados</Text>
          </View>

          <View style={styles.kpiRow}>
            <View style={[styles.kpiCard, styles.kpiCardPrimary]}>
              <Text style={styles.kpiLabelDark}>TOTAL A COBRAR</Text>
              <Text style={styles.kpiValueDark} numberOfLines={1} adjustsFontSizeToFit>
                {formatCentsToUSD(totalDebtCents)}
              </Text>
            </View>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>DEUDORES</Text>
              <Text style={styles.kpiValue}>{debtorsCount}</Text>
            </View>
          </View>

          <View style={styles.searchRow}>
            <View style={styles.searchBar}>
              <Ionicons name="search" size={18} color={Colors.textMuted} />
              <TextInput
                style={styles.searchInput}
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Buscar cliente o departamento..."
                placeholderTextColor={Colors.textMuted}
              />
              {searchQuery.length > 0 && (
                <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
                  <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
                </Pressable>
              )}
            </View>
            <Pressable
              style={[styles.filterPill, onlyWithDebt && styles.filterPillActive]}
              onPress={() => setOnlyWithDebt((prev) => !prev)}
            >
              <Text style={[styles.filterPillText, onlyWithDebt && styles.filterPillTextActive]}>
                Con deuda
              </Text>
            </Pressable>
          </View>

          <ErrorBanner message={errorMessage} />

          <FlatList
            data={filteredItems}
            keyExtractor={(entry) => entry.customer.id}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={isLoading}
                onRefresh={() => void refresh()}
                tintColor={Colors.primary}
              />
            }
            renderItem={({ item }) => {
              const hasDebt = item.balance.currentDebtCents > 0;
              return (
                <Pressable
                  style={({ pressed }) => [
                    styles.customerCard,
                    pressed && styles.customerCardPressed,
                  ]}
                  onPress={() => handleOpenCustomerDetail(item)}
                >
                  <View style={styles.avatarCircle}>
                    <Text style={styles.avatarLetter}>
                      {item.customer.fullName.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.customerInfo}>
                    <Text style={styles.customerName} numberOfLines={1}>
                      {item.customer.fullName}
                    </Text>
                    <Text style={styles.customerMeta} numberOfLines={1}>
                      {item.customer.notes ??
                        item.customer.phone ??
                        'Tocá para ver historial y cobrar'}
                    </Text>
                  </View>
                  <View style={[styles.debtPill, hasDebt ? styles.debtPillRed : styles.debtPillOk]}>
                    <Text
                      style={[
                        styles.debtPillText,
                        hasDebt ? styles.debtPillTextRed : styles.debtPillTextOk,
                      ]}
                    >
                      {hasDebt ? formatCentsToUSD(item.balance.currentDebtCents) : 'Al día'}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
                </Pressable>
              );
            }}
            ListEmptyComponent={
              <View style={styles.emptyCard}>
                <View style={styles.emptyIconCircle}>
                  <Ionicons name="people-outline" size={28} color={Colors.primary} />
                </View>
                <Text style={styles.emptyTitle}>
                  {onlyWithDebt ? 'Sin deudas pendientes' : 'Todavía no agendaste clientes'}
                </Text>
                <Text style={styles.emptySubtitle}>
                  {onlyWithDebt
                    ? 'Todos tus clientes están al día.'
                    : 'Agregá vecinos o clientes para llevar sus fiados en USD$ con precio congelado.'}
                </Text>
                {!onlyWithDebt && (
                  <Pressable style={styles.emptyCta} onPress={openCreateModal}>
                    <Ionicons name="person-add-outline" size={18} color={Colors.white} />
                    <Text style={styles.emptyCtaText}>Agendar primer cliente</Text>
                  </Pressable>
                )}
              </View>
            }
          />

          <Pressable
            style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
            onPress={openCreateModal}
          >
            <Ionicons name="person-add-outline" size={20} color={Colors.white} />
            <Text style={styles.fabText}>Cliente</Text>
          </Pressable>
        </View>

        {/* Modal de alta / edición de cliente */}
        <Modal
          visible={formModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setFormModalVisible(false)}
        >
          <KeyboardAvoidingView
            style={styles.modalBackdrop}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <View style={styles.dialogCard}>
              <Text style={styles.dialogTitle}>
                {editingCustomer ? 'Editar cliente' : 'Nuevo cliente'}
              </Text>
              <ErrorBanner message={formError} />
              <TextInput
                style={styles.input}
                value={formName}
                onChangeText={setFormName}
                placeholder="Nombre completo *"
                placeholderTextColor={Colors.textMuted}
                autoFocus
              />
              <TextInput
                style={styles.input}
                value={formPhone}
                onChangeText={setFormPhone}
                placeholder="Teléfono (opcional)"
                placeholderTextColor={Colors.textMuted}
                keyboardType="phone-pad"
              />
              <TextInput
                style={styles.input}
                value={formNotes}
                onChangeText={setFormNotes}
                placeholder="Nota (ej: Dpto 4°B, amigo...)"
                placeholderTextColor={Colors.textMuted}
              />
              <View style={styles.dialogActions}>
                <Pressable
                  style={styles.dialogCancelBtn}
                  onPress={() => setFormModalVisible(false)}
                  disabled={isSavingForm}
                >
                  <Text style={styles.dialogCancelText}>Cancelar</Text>
                </Pressable>
                <Pressable
                  style={styles.dialogSaveBtn}
                  onPress={() => void handleSaveCustomerForm()}
                  disabled={isSavingForm}
                >
                  {isSavingForm ? (
                    <ActivityIndicator color={Colors.white} size="small" />
                  ) : (
                    <Text style={styles.dialogSaveText}>Guardar</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* Modal de Ficha de Cuenta Corriente */}
        <Modal
          visible={selectedEntry !== null}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setSelectedEntry(null)}
        >
          {selectedEntry !== null && (
            <AgendaPaperBackground>
              <SafeAreaView style={styles.detailSafeArea} edges={['top', 'bottom']}>
                <View style={styles.detailHeader}>
                  <View style={styles.detailTitleBlock}>
                    <Text style={styles.kicker}>CUENTA CORRIENTE</Text>
                    <Text style={styles.detailName} numberOfLines={1}>
                      {selectedEntry.customer.fullName}
                    </Text>
                  </View>
                  <View style={styles.detailHeaderActions}>
                    <Pressable
                      style={styles.iconActionBtn}
                      onPress={() => openEditModal(selectedEntry.customer)}
                    >
                      <Ionicons name="pencil" size={18} color={Colors.textPrimary} />
                    </Pressable>
                    <Pressable style={styles.iconActionBtn} onPress={() => setSelectedEntry(null)}>
                      <Ionicons name="close" size={20} color={Colors.textPrimary} />
                    </Pressable>
                  </View>
                </View>

                <KeyboardAvoidingView
                  style={styles.flexOne}
                  behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                >
                  <ScrollView
                    contentContainerStyle={styles.detailScroll}
                    keyboardShouldPersistTaps="handled"
                  >
                    <ErrorBanner message={detailError} />

                    <View style={styles.balanceHero}>
                      <Text style={styles.kpiLabelDark}>DEUDA ACTUAL</Text>
                      <Text style={styles.balanceHeroAmount}>
                        {formatCentsToUSD(selectedEntry.balance.currentDebtCents)}
                      </Text>
                      <View style={styles.balanceMetaRow}>
                        <Text style={styles.balanceMetaText}>
                          Fiado: {formatCentsToUSD(selectedEntry.balance.totalCreditedCents)}
                        </Text>
                        <Text style={styles.balanceMetaText}>
                          Pagado: {formatCentsToUSD(selectedEntry.balance.totalPaidCents)}
                        </Text>
                      </View>
                    </View>

                    {selectedEntry.balance.currentDebtCents > 0 && (
                      <View style={styles.bentoCard}>
                        <Text style={styles.sectionKicker}>COBRAR DEUDA</Text>

                        <Pressable
                          style={({ pressed }) => [
                            styles.settleAllBtn,
                            (pressed || isRecordingPayment) && styles.btnPressedOpacity,
                          ]}
                          onPress={handleConfirmSettleAll}
                          disabled={isRecordingPayment}
                        >
                          <Ionicons name="checkmark-done-outline" size={20} color={Colors.white} />
                          <Text style={styles.settleAllBtnText}>
                            Saldar deuda total (
                            {formatCentsToUSD(selectedEntry.balance.currentDebtCents)})
                          </Text>
                        </Pressable>

                        <Text style={styles.orDividerLabel}>O registrar un pago parcial:</Text>

                        <View style={styles.paymentRow}>
                          <TextInput
                            style={[styles.input, styles.flexOne]}
                            value={paymentAmountInput}
                            onChangeText={setPaymentAmountInput}
                            onFocus={() => {
                              if (paymentAmountInput.trim() === '0') {
                                setPaymentAmountInput('');
                              }
                            }}
                            placeholder="Monto parcial (USD$)"
                            placeholderTextColor={Colors.textMuted}
                            keyboardType="decimal-pad"
                          />
                          <Pressable
                            style={styles.paySubmitBtn}
                            onPress={() => void handleRecordPartialPayment()}
                            disabled={isRecordingPayment}
                          >
                            {isRecordingPayment ? (
                              <ActivityIndicator color={Colors.white} size="small" />
                            ) : (
                              <Text style={styles.paySubmitText}>Cobrar</Text>
                            )}
                          </Pressable>
                        </View>

                        <TextInput
                          style={styles.input}
                          value={paymentNotesInput}
                          onChangeText={setPaymentNotesInput}
                          placeholder="Nota del pago (opcional, ej: Transferencia)"
                          placeholderTextColor={Colors.textMuted}
                        />
                      </View>
                    )}

                    <View style={styles.segmentedRow}>
                      <Pressable
                        style={[styles.segmentBtn, detailTab === 'SALES' && styles.segmentBtnActive]}
                        onPress={() => setDetailTab('SALES')}
                      >
                        <Text
                          style={[
                            styles.segmentText,
                            detailTab === 'SALES' && styles.segmentTextActive,
                          ]}
                        >
                          Fiados ({customerSales.length})
                        </Text>
                      </Pressable>
                      <Pressable
                        style={[
                          styles.segmentBtn,
                          detailTab === 'PAYMENTS' && styles.segmentBtnActive,
                        ]}
                        onPress={() => setDetailTab('PAYMENTS')}
                      >
                        <Text
                          style={[
                            styles.segmentText,
                            detailTab === 'PAYMENTS' && styles.segmentTextActive,
                          ]}
                        >
                          Pagos ({customerPayments.length})
                        </Text>
                      </Pressable>
                    </View>

                    {isLoadingDetail ? (
                      <ActivityIndicator color={Colors.primary} style={styles.loaderSpacer} />
                    ) : detailTab === 'SALES' ? (
                      customerSales.length === 0 ? (
                        <Text style={styles.emptyHistoryText}>Sin operaciones registradas.</Text>
                      ) : (
                        customerSales.map((sale) => {
                          const isVoided = sale.status === 'VOIDED';
                          const creditedCents = sale.totalCents - sale.paidCents;
                          const remainingSaleCents = Math.max(
                            0,
                            creditedCents - sale.directPaidCents
                          );
                          const isSettled =
                            !isVoided &&
                            (remainingSaleCents === 0 ||
                              selectedEntry.balance.currentDebtCents === 0);

                          return (
                            <View
                              key={sale.id}
                              style={[
                                styles.historyCard,
                                (isVoided || isSettled) && styles.historyCardSettled,
                              ]}
                            >
                              <View style={styles.historyTopRow}>
                                <Text style={styles.historyDate}>
                                  {formatShortDate(sale.createdAt)}
                                </Text>
                                <View
                                  style={[
                                    styles.statusPill,
                                    isVoided
                                      ? styles.statusVoided
                                      : isSettled
                                        ? styles.statusPaid
                                        : styles.statusCompleted,
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.statusPillText,
                                      isVoided
                                        ? styles.statusVoidedText
                                        : isSettled
                                          ? styles.statusPaidText
                                          : styles.statusCompletedText,
                                    ]}
                                  >
                                    {isVoided
                                      ? 'ANULADA'
                                      : isSettled
                                        ? 'PAGADA'
                                        : 'CONGELADO'}
                                  </Text>
                                </View>
                              </View>

                              {sale.items.map((item) => (
                                <View key={item.id} style={styles.saleItemRow}>
                                  <Text style={styles.saleItemName}>
                                    {formatStockQty(item.quantity, item.unitTypeSnapshot)} ·{' '}
                                    {item.productNameSnapshot}
                                  </Text>
                                  <Text style={styles.saleItemPrice}>
                                    {formatCentsToUSD(item.subtotalCents)}
                                  </Text>
                                </View>
                              ))}

                              <View style={styles.saleFooterRow}>
                                <Text style={styles.saleFooterSummary}>
                                  {isSettled
                                    ? `Saldada (${formatCentsToUSD(creditedCents)})`
                                    : sale.paidCents > 0
                                      ? `Adelantó ${formatCentsToUSD(sale.paidCents)} · Resta ${formatCentsToUSD(remainingSaleCents)}`
                                      : `Fiado: ${formatCentsToUSD(remainingSaleCents)}`}
                                </Text>

                                {!isVoided && !isSettled && (
                                  <View style={styles.saleCardActions}>
                                    <Pressable
                                      style={({ pressed }) => [
                                        styles.paySingleBtn,
                                        (pressed || isRecordingPayment) &&
                                          styles.btnPressedOpacity,
                                      ]}
                                      onPress={() =>
                                        handleConfirmPaySingleSale(sale, remainingSaleCents)
                                      }
                                      disabled={isRecordingPayment}
                                    >
                                      <Ionicons
                                        name="checkmark-circle-outline"
                                        size={16}
                                        color={Colors.white}
                                      />
                                      <Text style={styles.paySingleBtnText}>Pagar</Text>
                                    </Pressable>

                                    <Pressable
                                      style={styles.voidBtn}
                                      onPress={() => handleConfirmVoidSale(sale)}
                                      disabled={isRecordingPayment}
                                    >
                                      <Ionicons
                                        name="close-circle-outline"
                                        size={16}
                                        color={Colors.danger}
                                      />
                                      <Text style={styles.voidBtnText}>Anular</Text>
                                    </Pressable>
                                  </View>
                                )}
                              </View>
                            </View>
                          );
                        })
                      )
                    ) : customerPayments.length === 0 ? (
                      <Text style={styles.emptyHistoryText}>Todavía no registró pagos.</Text>
                    ) : (
                      customerPayments.map((pay) => (
                        <View key={pay.id} style={styles.historyCard}>
                          <View style={styles.historyTopRow}>
                            <Text style={styles.historyDate}>
                              {formatShortDate(pay.createdAt)}
                            </Text>
                            <Text style={styles.paymentAmount}>
                              + {formatCentsToUSD(pay.amountCents)}
                            </Text>
                          </View>
                          {pay.notes !== null && <Text style={styles.paymentNote}>{pay.notes}</Text>}
                        </View>
                      ))
                    )}

                    <Pressable
                      style={styles.deleteCustomerBtn}
                      onPress={handleConfirmDeleteCustomer}
                    >
                      <Ionicons name="trash-outline" size={18} color={Colors.danger} />
                      <Text style={styles.deleteCustomerText}>Quitar cliente de la agenda</Text>
                    </Pressable>
                  </ScrollView>
                </KeyboardAvoidingView>
              </SafeAreaView>
            </AgendaPaperBackground>
          )}
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
  flexOne: {
    flex: 1,
  },
  container: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
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
  kpiRow: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  kpiCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 2,
    ...Shadows.card,
  },
  kpiCardPrimary: {
    flex: 1.7,
    backgroundColor: Colors.vaultBackground,
    borderColor: Colors.vaultBorderHighlight,
  },
  kpiLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: Colors.textSecondary,
    letterSpacing: 0.8,
  },
  kpiLabelDark: {
    fontSize: 10,
    fontWeight: '800',
    color: Colors.vaultTextSecondary,
    letterSpacing: 0.8,
  },
  kpiValue: {
    fontSize: Typography.title,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  kpiValueDark: {
    fontSize: Typography.title,
    fontWeight: '800',
    color: Colors.gold,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    height: 44,
  },
  searchInput: {
    flex: 1,
    fontSize: Typography.body,
    color: Colors.textPrimary,
  },
  filterPill: {
    paddingHorizontal: Spacing.md,
    height: 44,
    borderRadius: Radius.full,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterPillActive: {
    backgroundColor: Colors.textPrimary,
    borderColor: Colors.textPrimary,
  },
  filterPillText: {
    fontSize: Typography.caption,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  filterPillTextActive: {
    color: Colors.white,
  },
  listContent: {
    gap: Spacing.sm,
    paddingBottom: 96,
  },
  customerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.card,
  },
  customerCardPressed: {
    borderColor: Colors.primaryLight,
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: {
    fontSize: Typography.subtitle,
    fontWeight: '800',
    color: Colors.primary,
  },
  customerInfo: {
    flex: 1,
    gap: 2,
  },
  customerName: {
    fontSize: Typography.body,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  customerMeta: {
    fontSize: Typography.caption,
    color: Colors.textSecondary,
  },
  debtPill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.full,
  },
  debtPillRed: {
    backgroundColor: Colors.dangerSoft,
  },
  debtPillOk: {
    backgroundColor: Colors.successSoft,
  },
  debtPillText: {
    fontSize: Typography.caption,
    fontWeight: '800',
  },
  debtPillTextRed: {
    color: Colors.danger,
  },
  debtPillTextOk: {
    color: Colors.success,
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
    ...Shadows.glowPrimary,
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
  dialogCard: {
    width: '100%',
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.md,
    ...Shadows.floating,
  },
  dialogTitle: {
    fontSize: Typography.subtitle,
    fontWeight: '800',
    color: Colors.textPrimary,
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
  dialogActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.sm,
  },
  dialogCancelBtn: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: 12,
  },
  dialogCancelText: {
    fontSize: Typography.body,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  dialogSaveBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.xl,
    paddingVertical: 12,
    borderRadius: Radius.md,
    minWidth: 100,
    alignItems: 'center',
  },
  dialogSaveText: {
    fontSize: Typography.body,
    fontWeight: '700',
    color: Colors.white,
  },
  detailSafeArea: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  detailTitleBlock: {
    flex: 1,
  },
  detailName: {
    fontSize: Typography.title,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  detailHeaderActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  iconActionBtn: {
    width: 38,
    height: 38,
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailScroll: {
    padding: Spacing.lg,
    gap: Spacing.md,
    paddingBottom: Spacing.xxl,
  },
  balanceHero: {
    backgroundColor: Colors.vaultBackground,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.vaultBorderHighlight,
    ...Shadows.floating,
  },
  balanceHeroAmount: {
    fontSize: 32,
    fontWeight: '800',
    color: Colors.gold,
  },
  balanceMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Spacing.sm,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.vaultBorder,
  },
  balanceMetaText: {
    fontSize: Typography.caption,
    fontWeight: '600',
    color: Colors.vaultTextSecondary,
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
  settleAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.success,
    paddingVertical: 14,
    borderRadius: Radius.md,
  },
  btnPressedOpacity: {
    opacity: 0.75,
  },
  settleAllBtnText: {
    color: Colors.white,
    fontSize: Typography.body,
    fontWeight: '800',
  },
  orDividerLabel: {
    fontSize: Typography.caption,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  paymentRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  paySubmitBtn: {
    backgroundColor: Colors.textPrimary,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 92,
  },
  paySubmitText: {
    color: Colors.white,
    fontSize: Typography.body,
    fontWeight: '700',
  },
  segmentedRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  segmentBtnActive: {
    backgroundColor: Colors.textPrimary,
    borderColor: Colors.textPrimary,
  },
  segmentText: {
    fontSize: Typography.caption,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  segmentTextActive: {
    color: Colors.white,
  },
  loaderSpacer: {
    marginVertical: Spacing.xl,
  },
  emptyHistoryText: {
    textAlign: 'center',
    color: Colors.textSecondary,
    fontSize: Typography.body,
    paddingVertical: Spacing.xl,
  },
  historyCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.card,
  },
  historyCardSettled: {
    opacity: 0.72,
  },
  historyTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  historyDate: {
    fontSize: Typography.caption,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.full,
  },
  statusCompleted: {
    backgroundColor: Colors.primarySoft,
  },
  statusPaid: {
    backgroundColor: Colors.successSoft,
  },
  statusVoided: {
    backgroundColor: Colors.dangerSoft,
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: '800',
  },
  statusCompletedText: {
    color: Colors.primary,
  },
  statusPaidText: {
    color: Colors.success,
  },
  statusVoidedText: {
    color: Colors.danger,
  },
  saleItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
  saleFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.borderSubtle,
    flexWrap: 'wrap',
  },
  saleFooterSummary: {
    flex: 1,
    minWidth: 120,
    fontSize: Typography.caption,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  saleCardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  paySingleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.success,
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
    borderRadius: Radius.full,
  },
  paySingleBtnText: {
    fontSize: Typography.caption,
    fontWeight: '800',
    color: Colors.white,
  },
  voidBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.dangerSoft,
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
    borderRadius: Radius.full,
  },
  voidBtnText: {
    fontSize: Typography.caption,
    fontWeight: '800',
    color: Colors.danger,
  },
  paymentAmount: {
    fontSize: Typography.subtitle,
    fontWeight: '800',
    color: Colors.success,
  },
  paymentNote: {
    fontSize: Typography.caption,
    color: Colors.textSecondary,
  },
  deleteCustomerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.md,
    paddingVertical: 14,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.dangerSoft,
    backgroundColor: Colors.surface,
  },
  deleteCustomerText: {
    color: Colors.danger,
    fontSize: Typography.body,
    fontWeight: '700',
  },
});