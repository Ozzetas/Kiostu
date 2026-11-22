import { EmergencyWipeService } from '../../application/services/EmergencyWipeService';
import { SessionPolicyService } from '../../application/services/SessionPolicyService';
import { AdjustStockUseCase } from '../../application/use-cases/AdjustStockUseCase';
import { AuthenticateUserUseCase } from '../../application/use-cases/AuthenticateUserUseCase';
import { ConfigureSecurityUseCase } from '../../application/use-cases/ConfigureSecurityUseCase';
import { RecordPaymentUseCase } from '../../application/use-cases/RecordPaymentUseCase';
import { RegisterSaleUseCase } from '../../application/use-cases/RegisterSaleUseCase';
import { DatabaseClient } from '../../data/database/DatabaseClient';
import { ImageStorageService } from '../../data/media/ImageStorageService';
import { SqliteCustomerRepository } from '../../data/repositories/SqliteCustomerRepository';
import { SqliteProductRepository } from '../../data/repositories/SqliteProductRepository';
import { SqliteSaleRepository } from '../../data/repositories/SqliteSaleRepository';
import { BiometricAuthAdapter } from '../../data/security/BiometricAuthAdapter';
import { KeychainCredentialStore } from '../../data/security/KeychainCredentialStore';
import { ICustomerRepository } from '../../domain/repositories/ICustomerRepository';
import { IProductRepository } from '../../domain/repositories/IProductRepository';
import { ISaleRepository } from '../../domain/repositories/ISaleRepository';
import {
    IBiometricAuthenticator,
    ISecurityRepository,
} from '../../domain/repositories/ISecurityRepository';
import { IImageStorageService } from '../../domain/services/IImageStorageService';

export interface AppServices {
  readonly databaseClient: DatabaseClient;
  readonly productRepository: IProductRepository;
  readonly customerRepository: ICustomerRepository;
  readonly saleRepository: ISaleRepository;
  readonly securityRepository: ISecurityRepository;
  readonly biometricAuth: IBiometricAuthenticator;
  readonly imageStorageService: IImageStorageService;
  readonly adjustStockUseCase: AdjustStockUseCase;
  readonly registerSaleUseCase: RegisterSaleUseCase;
  readonly recordPaymentUseCase: RecordPaymentUseCase;
  readonly configureSecurityUseCase: ConfigureSecurityUseCase;
  readonly authenticateUserUseCase: AuthenticateUserUseCase;
}

let containerInstance: AppServices | null = null;

// Centralizo el cableado de implementaciones concretas en un único punto para cumplir DIP en la capa UI.
export function getAppServices(): AppServices {
  if (containerInstance !== null) {
    return containerInstance;
  }

  const databaseClient = DatabaseClient.getInstance();
  const productRepository = new SqliteProductRepository(databaseClient);
  const customerRepository = new SqliteCustomerRepository(databaseClient);
  const saleRepository = new SqliteSaleRepository(databaseClient);
  const securityRepository = new KeychainCredentialStore();
  const biometricAuth = new BiometricAuthAdapter();
  const imageStorageService = new ImageStorageService();

  const sessionPolicyService = new SessionPolicyService();
  const emergencyWipeService = new EmergencyWipeService(databaseClient, securityRepository);

  containerInstance = {
    databaseClient,
    productRepository,
    customerRepository,
    saleRepository,
    securityRepository,
    biometricAuth,
    imageStorageService,
    adjustStockUseCase: new AdjustStockUseCase(productRepository),
    registerSaleUseCase: new RegisterSaleUseCase(saleRepository),
    recordPaymentUseCase: new RecordPaymentUseCase(customerRepository),
    configureSecurityUseCase: new ConfigureSecurityUseCase(securityRepository),
    authenticateUserUseCase: new AuthenticateUserUseCase(
      securityRepository,
      biometricAuth,
      sessionPolicyService,
      emergencyWipeService
    ),
  };

  return containerInstance;
}