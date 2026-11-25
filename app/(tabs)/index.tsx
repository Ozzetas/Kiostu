import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import { Product } from '../../src/domain/entities/types';
import { ErrorBanner } from '../../src/presentation/components/ErrorBanner';
import { ProductTile } from '../../src/presentation/components/ProductTile';
import { useSecuritySession } from '../../src/presentation/components/SecurityGate';
import { useAppServices } from '../../src/presentation/di/AppServicesProvider';
import { useCatalog } from '../../src/presentation/hooks/useCatalog';
import { Colors, Radius, Shadows, Spacing, Typography } from '../../src/presentation/theme/tokens';

const logger = new Logger('CatalogScreen');

export default function CatalogScreen() {
  const router = useRouter();
  const { services, notifyDataChanged } = useAppServices();
  const { lockNow } = useSecuritySession();

  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryModalVisible, setCategoryModalVisible] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [isSavingCategory, setIsSavingCategory] = useState(false);

  const { categories, products, isLoading, errorMessage, refresh } = useCatalog(selectedCategoryId);

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

  const handleOpenCreateProduct = (): void => {
    router.push('/modals/product-form');
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
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.kicker}>INVENTARIO LOCAL</Text>
            <Text style={styles.title}>Mi Kiosco</Text>
          </View>

          <Pressable
            style={({ pressed }) => [styles.lockButton, pressed && styles.lockButtonPressed]}
            onPress={lockNow}
            accessibilityLabel="Bloquear bóveda"
          >
            <Ionicons name="lock-closed-outline" size={20} color={Colors.textPrimary} />
          </Pressable>
        </View>

        <View style={styles.kpiRow}>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>PRODUCTOS</Text>
            <Text style={styles.kpiValue}>{products.length}</Text>
          </View>
          <View style={[styles.kpiCard, lowStockCount > 0 && styles.kpiCardAlert]}>
            <Text style={styles.kpiLabel}>STOCK BAJO</Text>
            <Text style={[styles.kpiValue, lowStockCount > 0 && styles.kpiValueAlert]}>
              {lowStockCount}
            </Text>
          </View>
        </View>

        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color={Colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Buscar jamón, alfombra, bebidas..."
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
                Todos
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
                  <Text style={[styles.categoryChipText, active && styles.categoryChipTextActive]}>
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
              <Text style={styles.addCategoryText}>Rubro</Text>
            </Pressable>
          </ScrollView>
        </View>

        <ErrorBanner message={errorMessage} />

        <FlatList
          data={filteredProducts}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={styles.gridContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isLoading}
              onRefresh={() => void refresh()}
              tintColor={Colors.primary}
            />
          }
          renderItem={({ item }) => (
            <ProductTile
              product={item}
              resolvedImageUri={services.imageStorageService.resolveImageUri(item.imageUri)}
              // En Fase 5B.2 el toque principal abrirá el modal de venta/fiado rápido; hoy abre edición/stock.
              onPress={handleOpenEditProduct}
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
                  : 'Tu catálogo está listo para arrancar'}
              </Text>
              <Text style={styles.emptySubtitle}>
                {searchQuery.trim().length > 0
                  ? 'Probá con otro nombre o quitá el filtro de rubro.'
                  : 'Cargá tu primer producto con foto desde cámara, galería o internet.'}
              </Text>
              {searchQuery.trim().length === 0 && (
                <Pressable
                  style={({ pressed }) => [
                    styles.emptyCta,
                    pressed && styles.emptyCtaPressed,
                  ]}
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

      <Modal
        visible={categoryModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCategoryModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Nuevo rubro o categoría</Text>
            <ErrorBanner message={categoryError} />
            <TextInput
              style={styles.modalInput}
              value={newCategoryName}
              onChangeText={setNewCategoryName}
              placeholder="Ej: Fiambrería, Alfombras, Bebidas..."
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  container: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.xs,
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
  lockButton: {
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
  lockButtonPressed: {
    backgroundColor: Colors.primarySoft,
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
  },
  kpiCardAlert: {
    borderColor: Colors.warning,
    backgroundColor: Colors.warningSoft,
  },
  kpiLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: Colors.textSecondary,
    letterSpacing: 0.8,
  },
  kpiValue: {
    fontSize: Typography.title,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  kpiValueAlert: {
    color: Colors.warning,
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
    height: 46,
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
    backgroundColor: 'rgba(9, 9, 11, 0.55)',
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
});