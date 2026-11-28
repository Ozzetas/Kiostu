import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { parseCurrencyToCents } from '../../src/core/utils/money';
import { formatCentsForInput, formatStockQty } from '../../src/core/utils/units';
import { Category, Product, UnitType } from '../../src/domain/entities/types';
import { ErrorBanner } from '../../src/presentation/components/ErrorBanner';
import { useAppServices } from '../../src/presentation/di/AppServicesProvider';
import { Colors, Radius, Shadows, Spacing, Typography } from '../../src/presentation/theme/tokens';

const logger = new Logger('ProductFormModal');

function parseNonNegativeInt(raw: string, label: string): number {
  const cleaned = raw.trim();
  if (!/^\d+$/.test(cleaned)) {
    throw new Error(`${label} debe ser un número entero mayor o igual a 0.`);
  }
  const value = Number(cleaned);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} excede el límite numérico permitido.`);
  }
  return value;
}

export default function ProductFormModal() {
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ productId?: string }>();
  const productId = typeof params.productId === 'string' ? params.productId : undefined;
  const isEditing = productId !== undefined;

  const { services, notifyDataChanged } = useAppServices();

  const [isLoadingInitial, setIsLoadingInitial] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isProcessingMedia, setIsProcessingMedia] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [categories, setCategories] = useState<readonly Category[]>([]);
  const [existingProduct, setExistingProduct] = useState<Product | null>(null);

  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [unitType, setUnitType] = useState<UnitType>('UNIT');
  const [priceBaseQty, setPriceBaseQty] = useState<number>(1);
  const [priceInput, setPriceInput] = useState('');
  const [initialStockInput, setInitialStockInput] = useState('0');
  const [minStockAlertInput, setMinStockAlertInput] = useState('0');
  const [imageFileName, setImageFileName] = useState<string | null>(null);
  const [originalImageFileName, setOriginalImageFileName] = useState<string | null>(null);

  const [showUrlBox, setShowUrlBox] = useState(false);
  const [remoteImageUrl, setRemoteImageUrl] = useState('');

  const [adjustDeltaInput, setAdjustDeltaInput] = useState('');
  const [adjustDirection, setAdjustDirection] = useState<'ADD' | 'SUB'>('ADD');
  const [isAdjustingStock, setIsAdjustingStock] = useState(false);

  useEffect(() => {
    navigation.setOptions({
      title: isEditing ? 'Editar producto' : 'Nuevo producto',
    });
  }, [navigation, isEditing]);

  useEffect(() => {
    let isMounted = true;

    async function loadFormData(): Promise<void> {
      try {
        const loadedCategories = await services.productRepository.listCategories();
        if (!isMounted) {
          return;
        }
        setCategories(loadedCategories);

        if (productId !== undefined) {
          const product = await services.productRepository.findById(productId);
          if (!isMounted) {
            return;
          }
          if (product === null) {
            setErrorMessage('El producto seleccionado ya no existe.');
          } else {
            setExistingProduct(product);
            setName(product.name);
            setCategoryId(product.categoryId);
            setUnitType(product.unitType);
            setPriceBaseQty(product.priceBaseQty);
            setPriceInput(formatCentsForInput(product.unitPriceCents));
            setMinStockAlertInput(String(product.minStockAlert));
            setImageFileName(product.imageUri);
            setOriginalImageFileName(product.imageUri);
          }
        }
      } catch (error: unknown) {
        const normalized = error instanceof Error ? error : new Error(String(error));
        logger.error('Error al cargar datos del formulario de producto', normalized, { productId });
        if (isMounted) {
          setErrorMessage(
            error instanceof AppError ? error.message : 'Error al cargar los datos del producto.'
          );
        }
      } finally {
        if (isMounted) {
          setIsLoadingInitial(false);
        }
      }
    }

    void loadFormData();
    return () => {
      isMounted = false;
    };
  }, [services, productId]);

  const handleSelectUnitType = (nextType: UnitType): void => {
    setUnitType(nextType);
    setPriceBaseQty(nextType === 'GRAM' ? 1000 : 1);
  };

  const handlePickCamera = async (): Promise<void> => {
    setErrorMessage(null);
    setIsProcessingMedia(true);
    try {
      const result = await services.imageStorageService.pickFromCamera();
      if (result !== null) {
        setImageFileName(result.fileName);
        setShowUrlBox(false);
      }
    } catch (error: unknown) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      logger.error('Error al capturar foto con cámara', normalized);
      setErrorMessage(
        error instanceof AppError ? error.message : 'No se pudo capturar la imagen.'
      );
    } finally {
      setIsProcessingMedia(false);
    }
  };

  const handlePickGallery = async (): Promise<void> => {
    setErrorMessage(null);
    setIsProcessingMedia(true);
    try {
      const result = await services.imageStorageService.pickFromGallery();
      if (result !== null) {
        setImageFileName(result.fileName);
        setShowUrlBox(false);
      }
    } catch (error: unknown) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      logger.error('Error al elegir foto desde galería', normalized);
      setErrorMessage(
        error instanceof AppError ? error.message : 'No se pudo cargar la foto de la galería.'
      );
    } finally {
      setIsProcessingMedia(false);
    }
  };

  const handleDownloadFromUrl = async (): Promise<void> => {
    setErrorMessage(null);
    setIsProcessingMedia(true);
    try {
      const result = await services.imageStorageService.importFromUrl(remoteImageUrl);
      setImageFileName(result.fileName);
      setRemoteImageUrl('');
      setShowUrlBox(false);
    } catch (error: unknown) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      logger.error('Error al importar imagen desde URL', normalized);
      setErrorMessage(
        error instanceof AppError ? error.message : 'No se pudo descargar la imagen del enlace.'
      );
    } finally {
      setIsProcessingMedia(false);
    }
  };

  const handleSave = async (): Promise<void> => {
    if (isSaving) {
      return;
    }

    setErrorMessage(null);
    setIsSaving(true);

    try {
      const cleanName = name.trim();
      if (cleanName.length === 0) {
        setErrorMessage('El nombre del producto es obligatorio.');
        return;
      }

      const unitPriceCents = parseCurrencyToCents(priceInput);
      const minStockAlert = parseNonNegativeInt(minStockAlertInput, 'La alerta de stock mínimo');

      if (isEditing && productId !== undefined) {
        await services.productRepository.updateProduct(productId, {
          name: cleanName,
          categoryId,
          unitPriceCents,
          priceBaseQty,
          minStockAlert,
          imageUri: imageFileName,
        });

        // Elimino la imagen reemplazada del disco para evitar archivos huérfanos.
        if (originalImageFileName !== null && originalImageFileName !== imageFileName) {
          await services.imageStorageService.deleteImage(originalImageFileName);
        }
      } else {
        const initialStockQty = parseNonNegativeInt(initialStockInput, 'El stock inicial');
        await services.productRepository.createProduct({
          name: cleanName,
          categoryId,
          unitType,
          unitPriceCents,
          priceBaseQty,
          initialStockQty,
          minStockAlert,
          imageUri: imageFileName,
        });
      }

      notifyDataChanged();
      router.back();
    } catch (error: unknown) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      logger.error('Error al guardar producto', normalized, { isEditing, productId });
      setErrorMessage(
        error instanceof AppError || error instanceof Error
          ? error.message
          : 'No se pudo guardar el producto.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleAdjustStock = async (): Promise<void> => {
    if (!existingProduct || isAdjustingStock) {
      return;
    }

    setErrorMessage(null);
    setIsAdjustingStock(true);

    try {
      const magnitude = parseNonNegativeInt(adjustDeltaInput, 'La cantidad de ajuste');
      if (magnitude === 0) {
        setErrorMessage('Ingresá una cantidad mayor a cero para ajustar el stock.');
        return;
      }

      const signedDelta = adjustDirection === 'ADD' ? magnitude : -magnitude;
      const updated = await services.adjustStockUseCase.execute({
        productId: existingProduct.id,
        deltaQty: signedDelta,
        movementType: adjustDirection === 'ADD' ? 'IN_PURCHASE' : 'ADJUSTMENT',
        reason: adjustDirection === 'ADD' ? 'Reposición manual' : 'Ajuste negativo manual',
      });

      setExistingProduct(updated);
      setAdjustDeltaInput('');
      notifyDataChanged();
    } catch (error: unknown) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      logger.error('Error al ajustar stock manualmente', normalized, {
        productId: existingProduct.id,
      });
      setErrorMessage(
        error instanceof AppError || error instanceof Error
          ? error.message
          : 'No se pudo actualizar el stock.'
      );
    } finally {
      setIsAdjustingStock(false);
    }
  };

  const handleConfirmDelete = (): void => {
    if (!existingProduct) {
      return;
    }

    Alert.alert(
      'Desactivar producto',
      `¿Querés quitar "${existingProduct.name}" del catálogo? Las deudas históricas de clientes que lo incluyan permanecerán intactas.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Quitar',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await services.productRepository.softDeleteProduct(existingProduct.id);
                notifyDataChanged();
                router.back();
              } catch (error: unknown) {
                const normalized = error instanceof Error ? error : new Error(String(error));
                logger.error('Error al desactivar producto', normalized, {
                  productId: existingProduct.id,
                });
                setErrorMessage(
                  error instanceof AppError ? error.message : 'No se pudo eliminar el producto.'
                );
              }
            })();
          },
        },
      ]
    );
  };

  if (isLoadingInitial) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </SafeAreaView>
    );
  }

  const previewUri = services.imageStorageService.resolveImageUri(imageFileName);

  return (
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

          <View style={styles.bentoCard}>
            <Text style={styles.sectionKicker}>ÍCONO VISUAL (300×300)</Text>
            <View style={styles.mediaRow}>
              <View style={styles.previewBox}>
                {isProcessingMedia ? (
                  <ActivityIndicator color={Colors.primary} />
                ) : previewUri !== null ? (
                  <Image source={{ uri: previewUri }} style={styles.previewImage} />
                ) : (
                  <Ionicons name="image-outline" size={32} color={Colors.textMuted} />
                )}
              </View>
              <View style={styles.mediaButtonsCol}>
                <Pressable
                  style={styles.mediaBtn}
                  onPress={() => void handlePickCamera()}
                  disabled={isProcessingMedia}
                >
                  <Ionicons name="camera-outline" size={18} color={Colors.primary} />
                  <Text style={styles.mediaBtnText}>Sacar foto</Text>
                </Pressable>
                <Pressable
                  style={styles.mediaBtn}
                  onPress={() => void handlePickGallery()}
                  disabled={isProcessingMedia}
                >
                  <Ionicons name="images-outline" size={18} color={Colors.primary} />
                  <Text style={styles.mediaBtnText}>Galería</Text>
                </Pressable>
                <Pressable
                  style={styles.mediaBtn}
                  onPress={() => setShowUrlBox((prev) => !prev)}
                  disabled={isProcessingMedia}
                >
                  <Ionicons name="link-outline" size={18} color={Colors.primary} />
                  <Text style={styles.mediaBtnText}>Desde internet (URL)</Text>
                </Pressable>
              </View>
            </View>

            {showUrlBox && (
              <View style={styles.urlRow}>
                <TextInput
                  style={styles.urlInput}
                  value={remoteImageUrl}
                  onChangeText={setRemoteImageUrl}
                  placeholder="https://... (JPG, PNG o WebP)"
                  placeholderTextColor={Colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Pressable
                  style={styles.urlDownloadBtn}
                  onPress={() => void handleDownloadFromUrl()}
                  disabled={isProcessingMedia}
                >
                  <Text style={styles.urlDownloadText}>Bajar</Text>
                </Pressable>
              </View>
            )}
          </View>

          <View style={styles.bentoCard}>
            <Text style={styles.sectionKicker}>DATOS DEL PRODUCTO</Text>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Nombre *</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="Ej: Jamón cocido, Alfombra 80x50, Coca-Cola..."
                placeholderTextColor={Colors.textMuted}
              />
            </View>

            {categories.length > 0 && (
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Categoría</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.pillsRow}
                >
                  <Pressable
                    style={[styles.pill, categoryId === null && styles.pillActive]}
                    onPress={() => setCategoryId(null)}
                  >
                    <Text style={[styles.pillText, categoryId === null && styles.pillTextActive]}>
                      Sin categoría
                    </Text>
                  </Pressable>
                  {categories.map((cat) => {
                    const active = categoryId === cat.id;
                    return (
                      <Pressable
                        key={cat.id}
                        style={[styles.pill, active && styles.pillActive]}
                        onPress={() => setCategoryId(cat.id)}
                      >
                        <Text style={[styles.pillText, active && styles.pillTextActive]}>
                          {cat.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>
                Forma de venta {isEditing ? '(bloqueada para preservar historial)' : '*'}
              </Text>
              <View style={styles.segmentedRow}>
                <Pressable
                  style={[styles.segmentBtn, unitType === 'UNIT' && styles.segmentBtnActive]}
                  onPress={() => !isEditing && handleSelectUnitType('UNIT')}
                  disabled={isEditing}
                >
                  <Text
                    style={[styles.segmentText, unitType === 'UNIT' && styles.segmentTextActive]}
                  >
                    Por Unidad
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.segmentBtn, unitType === 'GRAM' && styles.segmentBtnActive]}
                  onPress={() => !isEditing && handleSelectUnitType('GRAM')}
                  disabled={isEditing}
                >
                  <Text
                    style={[styles.segmentText, unitType === 'GRAM' && styles.segmentTextActive]}
                  >
                    Por Peso (gramos)
                  </Text>
                </Pressable>
              </View>
            </View>

            {unitType === 'GRAM' && (
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>El precio cargado corresponde a:</Text>
                <View style={styles.segmentedRow}>
                  <Pressable
                    style={[styles.segmentBtn, priceBaseQty === 1000 && styles.segmentBtnActive]}
                    onPress={() => setPriceBaseQty(1000)}
                  >
                    <Text
                      style={[
                        styles.segmentText,
                        priceBaseQty === 1000 && styles.segmentTextActive,
                      ]}
                    >
                      1 kg (1000g)
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[styles.segmentBtn, priceBaseQty === 100 && styles.segmentBtnActive]}
                    onPress={() => setPriceBaseQty(100)}
                  >
                    <Text
                      style={[
                        styles.segmentText,
                        priceBaseQty === 100 && styles.segmentTextActive,
                      ]}
                    >
                      100 gramos
                    </Text>
                  </Pressable>
                </View>
              </View>
            )}

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>
                Precio en pesos ($) *{' '}
                {unitType === 'GRAM'
                  ? `(por ${priceBaseQty === 1000 ? '1 kg' : '100g'})`
                  : '(por unidad)'}
              </Text>
              <TextInput
                style={styles.input}
                value={priceInput}
                onChangeText={setPriceInput}
                placeholder="Ej: 25000 o 1500.50"
                placeholderTextColor={Colors.textMuted}
                keyboardType="decimal-pad"
              />
            </View>

            <View style={styles.twoCols}>
              {!isEditing && (
                <View style={[styles.fieldGroup, styles.flexOne]}>
                  <Text style={styles.label}>
                    Stock inicial ({unitType === 'GRAM' ? 'gramos' : 'u.'})
                  </Text>
                  <TextInput
                    style={styles.input}
                    value={initialStockInput}
                    onChangeText={setInitialStockInput}
                    placeholder={unitType === 'GRAM' ? 'Ej: 3000' : 'Ej: 20'}
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="number-pad"
                  />
                </View>
              )}
              <View style={[styles.fieldGroup, styles.flexOne]}>
                <Text style={styles.label}>
                  Alerta stock bajo ({unitType === 'GRAM' ? 'gramos' : 'u.'})
                </Text>
                <TextInput
                  style={styles.input}
                  value={minStockAlertInput}
                  onChangeText={setMinStockAlertInput}
                  placeholder={unitType === 'GRAM' ? 'Ej: 500' : 'Ej: 5'}
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="number-pad"
                />
              </View>
            </View>
          </View>

          {isEditing && existingProduct !== null && (
            <View style={styles.bentoCard}>
              <View style={styles.stockHeaderRow}>
                <Text style={styles.sectionKicker}>MOVIMIENTO DE STOCK</Text>
                <Text style={styles.currentStockBadge}>
                  Actual: {formatStockQty(existingProduct.stockQty, existingProduct.unitType)}
                </Text>
              </View>
              <View style={styles.segmentedRow}>
                <Pressable
                  style={[styles.segmentBtn, adjustDirection === 'ADD' && styles.segmentBtnSuccess]}
                  onPress={() => setAdjustDirection('ADD')}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      adjustDirection === 'ADD' && styles.segmentTextActive,
                    ]}
                  >
                    + Reponer
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.segmentBtn, adjustDirection === 'SUB' && styles.segmentBtnDanger]}
                  onPress={() => setAdjustDirection('SUB')}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      adjustDirection === 'SUB' && styles.segmentTextActive,
                    ]}
                  >
                    - Descontar
                  </Text>
                </Pressable>
              </View>
              <View style={styles.urlRow}>
                <TextInput
                  style={styles.urlInput}
                  value={adjustDeltaInput}
                  onChangeText={setAdjustDeltaInput}
                  placeholder={
                    existingProduct.unitType === 'GRAM' ? 'Cantidad en gramos' : 'Cantidad en u.'
                  }
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="number-pad"
                />
                <Pressable
                  style={styles.urlDownloadBtn}
                  onPress={() => void handleAdjustStock()}
                  disabled={isAdjustingStock}
                >
                  {isAdjustingStock ? (
                    <ActivityIndicator color={Colors.white} size="small" />
                  ) : (
                    <Text style={styles.urlDownloadText}>Aplicar</Text>
                  )}
                </Pressable>
              </View>
            </View>
          )}

          <Pressable
            style={({ pressed }) => [
              styles.saveButton,
              (pressed || isSaving) && styles.saveButtonPressed,
            ]}
            onPress={() => void handleSave()}
            disabled={isSaving}
          >
            {isSaving ? (
              <ActivityIndicator color={Colors.white} />
            ) : (
              <Text style={styles.saveButtonText}>
                {isEditing ? 'Guardar cambios' : 'Crear producto'}
              </Text>
            )}
          </Pressable>

          {isEditing && existingProduct !== null && (
            <Pressable style={styles.deleteButton} onPress={handleConfirmDelete}>
              <Ionicons name="trash-outline" size={18} color={Colors.danger} />
              <Text style={styles.deleteButtonText}>Quitar del catálogo</Text>
            </Pressable>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  flexOne: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },
  scrollContent: {
    padding: Spacing.lg,
    gap: Spacing.lg,
    paddingBottom: Spacing.xxl,
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
  mediaRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    alignItems: 'center',
  },
  previewBox: {
    width: 112,
    height: 112,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  mediaButtonsCol: {
    flex: 1,
    gap: Spacing.sm,
  },
  mediaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primarySoft,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    borderRadius: Radius.md,
  },
  mediaBtnText: {
    fontSize: Typography.caption,
    fontWeight: '700',
    color: Colors.primary,
  },
  urlRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'center',
  },
  urlInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 11,
    fontSize: Typography.body,
    color: Colors.textPrimary,
    backgroundColor: Colors.background,
  },
  urlDownloadBtn: {
    backgroundColor: Colors.textPrimary,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 12,
    borderRadius: Radius.md,
    minWidth: 80,
    alignItems: 'center',
  },
  urlDownloadText: {
    color: Colors.white,
    fontSize: Typography.caption,
    fontWeight: '700',
  },
  fieldGroup: {
    gap: Spacing.xs,
  },
  label: {
    fontSize: Typography.caption,
    fontWeight: '600',
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
  pillsRow: {
    gap: Spacing.sm,
  },
  pill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: Radius.full,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  pillActive: {
    backgroundColor: Colors.textPrimary,
    borderColor: Colors.textPrimary,
  },
  pillText: {
    fontSize: Typography.caption,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  pillTextActive: {
    color: Colors.white,
  },
  segmentedRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
    alignItems: 'center',
  },
  segmentBtnActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  segmentBtnSuccess: {
    backgroundColor: Colors.success,
    borderColor: Colors.success,
  },
  segmentBtnDanger: {
    backgroundColor: Colors.danger,
    borderColor: Colors.danger,
  },
  segmentText: {
    fontSize: Typography.caption,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  segmentTextActive: {
    color: Colors.white,
  },
  twoCols: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  stockHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  currentStockBadge: {
    fontSize: Typography.caption,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  saveButton: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 54,
    ...Shadows.glowPrimary,
  },
  saveButtonPressed: {
    backgroundColor: Colors.primaryPressed,
  },
  saveButtonText: {
    color: Colors.white,
    fontSize: Typography.body,
    fontWeight: '700',
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: 14,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.dangerSoft,
    backgroundColor: Colors.surface,
  },
  deleteButtonText: {
    color: Colors.danger,
    fontSize: Typography.body,
    fontWeight: '700',
  },
});