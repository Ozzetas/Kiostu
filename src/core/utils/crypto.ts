import * as Crypto from 'expo-crypto';
import { CredentialHashRecord } from '../../domain/entities/security';
import { SecurityError } from '../errors/AppError';

const SALT_BYTE_LENGTH = 16;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  // Comparo carácter a carácter con XOR para mitigar ataques de canal lateral por tiempo de respuesta.
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return diff === 0;
}

export async function createSaltedHash(
  secret: string,
  domainTag: 'primary' | 'panic'
): Promise<CredentialHashRecord> {
  try {
    const saltBytes = await Crypto.getRandomBytesAsync(SALT_BYTE_LENGTH);
    const saltHex = bytesToHex(saltBytes);
    // Incluyo un prefijo de dominio para evitar reutilización cruzada de hashes entre credenciales.
    const payload = `${domainTag}:${saltHex}:${secret}`;
    const hashHex = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, payload);

    return { saltHex, hashHex };
  } catch (error: unknown) {
    throw new SecurityError(
      'CRYPTO_OPERATION_ERROR',
      'Fallo al generar el hash criptográfico de la credencial',
      { domainTag },
      error
    );
  }
}

export async function verifySaltedHash(
  candidateSecret: string,
  stored: CredentialHashRecord,
  domainTag: 'primary' | 'panic'
): Promise<boolean> {
  try {
    const payload = `${domainTag}:${stored.saltHex}:${candidateSecret}`;
    const candidateHash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      payload
    );

    return constantTimeEqual(candidateHash, stored.hashHex);
  } catch (error: unknown) {
    throw new SecurityError(
      'CRYPTO_OPERATION_ERROR',
      'Fallo al verificar la credencial contra el hash almacenado',
      { domainTag },
      error
    );
  }
}