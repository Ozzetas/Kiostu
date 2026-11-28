import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
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
import { formatCentsToUSD, parseCurrencyToCents } from '../../src/core/utils/money';
import {
  encodeEmojiVisual,
  isStoredImageFileName,
  parseProductVisual,
} from '../../src/core/utils/productVisual';
import { formatCentsForInput, formatStockQty } from '../../src/core/utils/units';
import { Category, Product, UnitType } from '../../src/domain/entities/types';
import { AgendaPaperBackground } from '../../src/presentation/components/AgendaPaperBackground';
import { ErrorBanner } from '../../src/presentation/components/ErrorBanner';
import {
  GramPriceBaseOption,
  PriceBaseSlider,
} from '../../src/presentation/components/PriceBaseSlider';
import { useAppServices } from '../../src/presentation/di/AppServicesProvider';
import { Colors, Radius, Shadows, Spacing, Typography } from '../../src/presentation/theme/tokens';

const logger = new Logger('ProductFormModal');

const EMOJI_PRESETS: readonly string[] = [
  '🥩',
  '🧀',
  '🍞',
  '🥤',
  '🍫',
  '☕',
  '🧶',
  '⌚',
  '🍺',
  '🍪',
  '🧴',
  '📦',
];

function parseOptionalNonNegativeInt(raw: string, label: string): number {
  const cleaned = raw.trim();
  if (cleaned.length === 0) {
    return 0;
  }
  if (!/^\d+$/.test(cleaned)) {
    throw new Error(`${label} debe ser un número entero mayor o igual a 0.`);
  }
  const value = Number(cleaned);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} excede el límite numérico permitido.`);
  }
  return value;
}

function tryParseCents(raw: string): number | null {
  const cleaned = raw.trim();
  if (cleaned.length === 0) {
    return null;
  }
  try {
    return parseCurrencyToCents(cleaned);
  } catch {
    return null;
  }
}

function formatPriceBaseDescription(unitType: UnitType, priceBaseQty: number): string {
  if (unitType === 'UNIT') {
    return 'por 1 unidad';
  }
  if (priceBaseQty === 1000) {
    return 'por 1 kg (1000 g)';
  }
  if (priceBaseQty === 1) {
    return 'por 1 gramo';
  }
  return `por ${priceBaseQty} gramos`;
}

function formatMarginPercent(profitCents: number, costCents: number): string | null {
  if (costCents <= 0) {
    return null;
  }
  const pct = Math.round((profitCents / costCents) * 100);
  return `${pct >= 0 ? '+' : ''}${pct}%`;
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

  // Dejo los inputs numéricos vacíos con placeholder "0" para evitar escribir adelante de un cero inicial.
  const [costPriceInput, setCostPriceInput] = useState('');
  const [wholesalePriceInput, setWholesalePriceInput] = useState('');
  const [retailPriceInput, setRetailPriceInput] = useState('');
  const [initialStockInput, setInitialStockInput] = useState('');
  const [minStockAlertInput, setMinStockAlertInput] = useState('');

  const [imageValue, setImageValue] = useState<string | null>(null);
  const [originalImageValue, setOriginalImageValue] = useState<string | null>(null);

  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [customEmojiInput, setCustomEmojiInput] = useState('');

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
            setCostPriceInput(
              product.costPriceCents > 0 ? formatCentsForInput(product.costPriceCents) : ''
            );
            setWholesalePriceInput(
              product.wholesalePriceCents > 0
                ? formatCentsForInput(product.wholesalePriceCents)
                : ''
            );
            setRetailPriceInput(
              product.unitPriceCents > 0 ? formatCentsForInput(product.unitPriceCents) : ''
            );
            setMinStockAlertInput(
              product.minStockAlert > 0 ? String(product.minStockAlert) : ''
            );
            setImageValue(product.imageUri);
            setOriginalImageValue(product.imageUri);

            const parsed = parseProductVisual(product.imageUri);
            if (parsed.kind === 'EMOJI') {
              setCustomEmojiInput(parsed.emoji);
            }
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

  // Limpio automáticamente el cero si el usuario enfoca un campo que quedó en "0".
  const clearZeroOnFocus = (current: string, setter: (val: string) => void): void => {
    if (current.trim() === '0') {
      setter('');
    }
  };

  // Remuevo ceros sobrantes a la izquierda en enteros (ej. si pega "05" pasa a "5").
  const handleIntegerChange = (raw: string, setter: (val: string) => void): void => {
    const digitsOnly = raw.replace(/[^\d]/g, '');
    if (digitsOnly.length > 1 && digitsOnly.startsWith('0')) {
      setter(digitsOnly.replace(/^0+/, '') || '0');
      return;
    }
    setter(digitsOnly);
  };

  const livePricingPreview = useMemo(() => {
    const costCents = tryParseCents(costPriceInput) ?? 0;
    const retailCents = tryParseCents(retailPriceInput);
    const wholesaleParsed = tryParseCents(wholesalePriceInput);
    const effectiveWholesaleCents = wholesaleParsed ?? retailCents;

    return {
      costCents,
      retailCents,
      wholesaleCents: effectiveWholesaleCents,
      retailProfitCents: retailCents !== null ? retailCents - costCents : null,
      wholesaleProfitCents:
        effectiveWholesaleCents !== null ? effectiveWholesaleCents - costCents : null,
    };
  }, [costPriceInput, wholesalePriceInput, retailPriceInput]);

  const handleSelectUnitType = (nextType: UnitType): void => {
    setUnitType(nextType);
    setPriceBaseQty(nextType === 'GRAM' ? 1000 : 1);
  };

  const handleSelectGramBase = (nextBase: GramPriceBaseOption): void => {
    setPriceBaseQty(nextBase);
  };

  const handlePickCamera = async (): Promise<void> => {
    setErrorMessage(null);
    setIsProcessingMedia(true);
    try {
      const result = await services.imageStorageService.pickFromCamera();
      if (result !== null) {
        setImageValue(result.fileName);
        setCustomEmojiInput('');
        setShowEmojiPicker(false);
      }
    } catch (error: unknown) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      logger.error('Error al capturar foto con cámara', normalized);
      setErrorMessage(error instanceof AppError ? error.message : 'No se pudo capturar la imagen.');
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
        setImageValue(result.fileName);
        setCustomEmojiInput('');
        setShowEmojiPicker(false);
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

  const handleSelectEmojiPreset = (emoji: string): void => {
    setErrorMessage(null);
    setCustomEmojiInput(emoji);
    setImageValue(encodeEmojiVisual(emoji));
  };

  const handleCustomEmojiChange = (rawText: string): void => {
    const cleaned = rawText.replace(/\s+/g, '').trim();
    setCustomEmojiInput(cleaned);
    if (cleaned.length > 0) {
      setImageValue(encodeEmojiVisual(cleaned));
    } else if (parseProductVisual(imageValue).kind === 'EMOJI') {
      setImageValue(null);
    }
  };

  const handleClearVisual = (): void => {
    setImageValue(null);
    setCustomEmojiInput('');
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

      if (retailPriceInput.trim().length === 0) {
        setErrorMessage('Ingresá el precio de venta al minoreo en USD$.');
        return;
      }

      const retailPriceCents = parseCurrencyToCents(retailPriceInput);
      const costPriceCents =
        costPriceInput.trim().length > 0 ? parseCurrencyToCents(costPriceInput) : 0;
      // Si el usuario no define precio de mayoreo aparte, hereda el de minoreo para no frenar el alta.
      const wholesalePriceCents =
        wholesalePriceInput.trim().length > 0
          ? parseCurrencyToCents(wholesalePriceInput)
          : retailPriceCents;

      const minStockAlert = parseOptionalNonNegativeInt(
        minStockAlertInput,
        'La alerta de stock mínimo'
      );

      if (isEditing && productId !== undefined) {
        await services.productRepository.updateProduct(productId, {
          name: cleanName,
          categoryId,
          costPriceCents,
          wholesalePriceCents,
          unitPriceCents: retailPriceCents,
          priceBaseQty,
          minStockAlert,
          imageUri: imageValue,
        });

        // Elimino del disco solo si el valor anterior era una foto real reemplazada (nunca un emoji).
        if (isStoredImageFileName(originalImageValue) && originalImageValue !== imageValue) {
          await services.imageStorageService.deleteImage(originalImageValue);
        }
      } else {
        const initialStockQty = parseOptionalNonNegativeInt(initialStockInput, 'El stock inicial');
        await services.productRepository.createProduct({
          name: cleanName,
          categoryId,
          unitType,
          costPriceCents,
          wholesalePriceCents,
          unitPriceCents: retailPriceCents,
          priceBaseQty,
          initialStockQty,
          minStockAlert,
          imageUri: imageValue,
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
      const magnitude = parseOptionalNonNegativeInt(adjustDeltaInput, 'La cantidad de ajuste');
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
      <AgendaPaperBackground>
        <SafeAreaView style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </SafeAreaView>
      </AgendaPaperBackground>
    );
  }

  const parsedVisual = parseProductVisual(imageValue);
  const previewUri =
    parsedVisual.kind === 'IMAGE'
      ? services.imageStorageService.resolveImageUri(parsedVisual.fileName)
      : null;
  const priceBaseDesc = formatPriceBaseDescription(unitType, priceBaseQty);

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

            {/* Ícono visual */}
            <View style={styles.bentoCard}>
              <View style={styles.cardHeaderRow}>
                <Text style={styles.sectionKicker}>ÍCONO VISUAL (100% LOCAL)</Text>
                {imageValue !== null && (
                  <Pressable onPress={handleClearVisual} hitSlop={8}>
                    <Text style={styles.clearVisualText}>Quitar</Text>
                  </Pressable>
                )}
              </View>

              <View style={styles.mediaRow}>
                <View style={styles.previewBox}>
                  {isProcessingMedia ? (
                    <ActivityIndicator color={Colors.primary} />
                  ) : parsedVisual.kind === 'EMOJI' ? (
                    <Text style={styles.previewEmoji}>{parsedVisual.emoji}</Text>
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
                    style={[styles.mediaBtn, showEmojiPicker && styles.mediaBtnActive]}
                    onPress={() => setShowEmojiPicker((prev) => !prev)}
                    disabled={isProcessingMedia}
                  >
                    <Ionicons
                      name="happy-outline"
                      size={18}
                      color={showEmojiPicker ? Colors.white : Colors.primary}
                    />
                    <Text
                      style={[
                        styles.mediaBtnText,
                        showEmojiPicker && styles.mediaBtnTextActive,
                      ]}
                    >
                      Usar emoji
                    </Text>
                  </Pressable>
                </View>
              </View>

              {showEmojiPicker && (
                <View style={styles.emojiPanel}>
                  <Text style={styles.label}>
                    Elegí un emoji rápido o usá el teclado del celular
                  </Text>
                  <View style={styles.emojiGrid}>
                    {EMOJI_PRESETS.map((emoji) => {
                      const active =
                        parsedVisual.kind === 'EMOJI' && parsedVisual.emoji === emoji;
                      return (
                        <Pressable
                          key={emoji}
                          style={[styles.emojiChip, active && styles.emojiChipActive]}
                          onPress={() => handleSelectEmojiPreset(emoji)}
                        >
                          <Text style={styles.emojiChipGlyph}>{emoji}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <TextInput
                    style={styles.emojiInput}
                    value={customEmojiInput}
                    onChangeText={handleCustomEmojiChange}
                    placeholder="Tocá acá y elegí cualquier emoji de tu teclado 😊"
                    placeholderTextColor={Colors.textMuted}
                    maxLength={12}
                    autoCorrect={false}
                  />
                </View>
              )}
            </View>

            {/* Datos generales y unidad */}
            <View style={styles.bentoCard}>
              <Text style={styles.sectionKicker}>DATOS DEL PRODUCTO</Text>

              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Nombre *</Text>
                <TextInput
                  style={styles.input}
                  value={name}
                  onChangeText={setName}
                  placeholder="Ej: Manzana, Jamón cocido, Alfombra..."
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
                  <Text style={styles.label}>Deslizá para elegir la base de precio:</Text>
                  <PriceBaseSlider value={priceBaseQty} onChange={handleSelectGramBase} />
                </View>
              )}
            </View>

            {/* Costo, Mayoreo, Minoreo y Rentabilidad en vivo */}
            <View style={styles.bentoCard}>
              <View style={styles.cardHeaderRow}>
                <Text style={styles.sectionKicker}>COSTO Y PRECIOS (USD$)</Text>
                <Text style={styles.baseBadge}>{priceBaseDesc}</Text>
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Costo real de compra (USD$)</Text>
                <TextInput
                  style={styles.input}
                  value={costPriceInput}
                  onChangeText={setCostPriceInput}
                  onFocus={() => clearZeroOnFocus(costPriceInput, setCostPriceInput)}
                  selectTextOnFocus
                  placeholder="0 (ej: 5)"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="decimal-pad"
                />
              </View>

              <View style={styles.twoCols}>
                <View style={[styles.fieldGroup, styles.flexOne]}>
                  <Text style={styles.label}>Venta Mayoreo (USD$)</Text>
                  <TextInput
                    style={styles.input}
                    value={wholesalePriceInput}
                    onChangeText={setWholesalePriceInput}
                    onFocus={() => clearZeroOnFocus(wholesalePriceInput, setWholesalePriceInput)}
                    selectTextOnFocus
                    placeholder="Ej: 6"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="decimal-pad"
                  />
                </View>

                <View style={[styles.fieldGroup, styles.flexOne]}>
                  <Text style={styles.label}>Venta Minoreo (USD$) *</Text>
                  <TextInput
                    style={styles.input}
                    value={retailPriceInput}
                    onChangeText={setRetailPriceInput}
                    onFocus={() => clearZeroOnFocus(retailPriceInput, setRetailPriceInput)}
                    selectTextOnFocus
                    placeholder="Ej: 9"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="decimal-pad"
                  />
                </View>
              </View>

              {livePricingPreview.retailCents !== null && (
                <View style={styles.marginBox}>
                  <Text style={styles.marginBoxKicker}>
                    GANANCIA REAL ESTIMADA ({priceBaseDesc.toUpperCase()})
                  </Text>
                  <View style={styles.marginRow}>
                    <View style={styles.marginTile}>
                      <Text style={styles.marginTileLabel}>MAYOREO</Text>
                      <Text
                        style={[
                          styles.marginTileValue,
                          (livePricingPreview.wholesaleProfitCents ?? 0) < 0 &&
                            styles.marginNegative,
                        ]}
                      >
                        {formatCentsToUSD(livePricingPreview.wholesaleProfitCents ?? 0)}
                      </Text>
                      {livePricingPreview.wholesaleProfitCents !== null &&
                        formatMarginPercent(
                          livePricingPreview.wholesaleProfitCents,
                          livePricingPreview.costCents
                        ) !== null && (
                          <Text style={styles.marginTilePct}>
                            {formatMarginPercent(
                              livePricingPreview.wholesaleProfitCents,
                              livePricingPreview.costCents
                            )}{' '}
                            sobre costo
                          </Text>
                        )}
                    </View>

                    <View style={styles.marginDivider} />

                    <View style={styles.marginTile}>
                      <Text style={styles.marginTileLabel}>MINOREO</Text>
                      <Text
                        style={[
                          styles.marginTileValue,
                          (livePricingPreview.retailProfitCents ?? 0) < 0 && styles.marginNegative,
                        ]}
                      >
                        {formatCentsToUSD(livePricingPreview.retailProfitCents ?? 0)}
                      </Text>
                      {livePricingPreview.retailProfitCents !== null &&
                        formatMarginPercent(
                          livePricingPreview.retailProfitCents,
                          livePricingPreview.costCents
                        ) !== null && (
                          <Text style={styles.marginTilePct}>
                            {formatMarginPercent(
                              livePricingPreview.retailProfitCents,
                              livePricingPreview.costCents
                            )}{' '}
                            sobre costo
                          </Text>
                        )}
                    </View>
                  </View>
                </View>
              )}
            </View>

            {/* Stock */}
            <View style={styles.bentoCard}>
              <Text style={styles.sectionKicker}>INVENTARIO Y ALERTAS</Text>
              <View style={styles.twoCols}>
                {!isEditing && (
                  <View style={[styles.fieldGroup, styles.flexOne]}>
                    <Text style={styles.label}>
                      Stock inicial ({unitType === 'GRAM' ? 'gramos' : 'u.'})
                    </Text>
                    <TextInput
                      style={styles.input}
                      value={initialStockInput}
                      onChangeText={(txt) => handleIntegerChange(txt, setInitialStockInput)}
                      onFocus={() => clearZeroOnFocus(initialStockInput, setInitialStockInput)}
                      selectTextOnFocus
                      placeholder="0"
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
                    onChangeText={(txt) => handleIntegerChange(txt, setMinStockAlertInput)}
                    onFocus={() => clearZeroOnFocus(minStockAlertInput, setMinStockAlertInput)}
                    selectTextOnFocus
                    placeholder="0"
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
                    style={[
                      styles.segmentBtn,
                      adjustDirection === 'ADD' && styles.segmentBtnSuccess,
                    ]}
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
                    style={[
                      styles.segmentBtn,
                      adjustDirection === 'SUB' && styles.segmentBtnDanger,
                    ]}
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
                <View style={styles.adjustRow}>
                  <TextInput
                    style={styles.adjustInput}
                    value={adjustDeltaInput}
                    onChangeText={(txt) => handleIntegerChange(txt, setAdjustDeltaInput)}
                    onFocus={() => clearZeroOnFocus(adjustDeltaInput, setAdjustDeltaInput)}
                    selectTextOnFocus
                    placeholder={
                      existingProduct.unitType === 'GRAM'
                        ? 'Cantidad en gramos'
                        : 'Cantidad en u.'
                    }
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="number-pad"
                  />
                  <Pressable
                    style={styles.adjustApplyBtn}
                    onPress={() => void handleAdjustStock()}
                    disabled={isAdjustingStock}
                  >
                    {isAdjustingStock ? (
                      <ActivityIndicator color={Colors.white} size="small" />
                    ) : (
                      <Text style={styles.adjustApplyText}>Aplicar</Text>
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
    backgroundColor: 'transparent',
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
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  sectionKicker: {
    fontSize: Typography.micro,
    fontWeight: '800',
    color: Colors.primary,
    letterSpacing: 1,
  },
  baseBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
    backgroundColor: Colors.surfaceElevated,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: Radius.full,
  },
  clearVisualText: {
    fontSize: Typography.caption,
    fontWeight: '700',
    color: Colors.danger,
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
  previewEmoji: {
    fontSize: 54,
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
  mediaBtnActive: {
    backgroundColor: Colors.primary,
  },
  mediaBtnText: {
    fontSize: Typography.caption,
    fontWeight: '700',
    color: Colors.primary,
  },
  mediaBtnTextActive: {
    color: Colors.white,
  },
  emojiPanel: {
    gap: Spacing.sm,
    paddingTop: Spacing.xs,
    borderTopWidth: 1,
    borderTopColor: Colors.borderSubtle,
  },
  emojiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  emojiChip: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiChipActive: {
    backgroundColor: Colors.primarySoft,
    borderColor: Colors.primary,
  },
  emojiChipGlyph: {
    fontSize: 24,
  },
  emojiInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 11,
    fontSize: Typography.body,
    color: Colors.textPrimary,
    backgroundColor: Colors.background,
  },
  marginBox: {
    backgroundColor: Colors.vaultBackground,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.vaultBorderHighlight,
  },
  marginBoxKicker: {
    fontSize: 10,
    fontWeight: '800',
    color: Colors.vaultTextSecondary,
    letterSpacing: 1,
  },
  marginRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  marginTile: {
    flex: 1,
    gap: 2,
  },
  marginDivider: {
    width: 1,
    height: 44,
    backgroundColor: Colors.vaultBorderHighlight,
    marginHorizontal: Spacing.md,
  },
  marginTileLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: Colors.gold,
    letterSpacing: 0.8,
  },
  marginTileValue: {
    fontSize: Typography.subtitle,
    fontWeight: '800',
    color: Colors.primaryLight,
  },
  marginNegative: {
    color: '#FCA5A5',
  },
  marginTilePct: {
    fontSize: 11,
    color: Colors.vaultTextSecondary,
    fontWeight: '600',
  },
  adjustRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'center',
  },
  adjustInput: {
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
  adjustApplyBtn: {
    backgroundColor: Colors.textPrimary,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 12,
    borderRadius: Radius.md,
    minWidth: 80,
    alignItems: 'center',
  },
  adjustApplyText: {
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