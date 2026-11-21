import { Customer, CustomerBalance, CustomerPayment } from '../entities/types';

export interface CreateCustomerInput {
  readonly fullName: string;
  readonly phone: string | null;
  readonly notes: string | null;
}

export interface UpdateCustomerInput {
  readonly fullName?: string;
  readonly phone?: string | null;
  readonly notes?: string | null;
}

export interface RecordPaymentPersistenceInput {
  readonly customerId: string;
  readonly amountCents: number;
  readonly notes: string | null;
}

export interface ICustomerRepository {
  listActiveCustomers(): Promise<Customer[]>;
  listBalances(onlyWithDebt?: boolean): Promise<CustomerBalance[]>;
  findById(customerId: string): Promise<Customer | null>;
  getBalanceByCustomerId(customerId: string): Promise<CustomerBalance | null>;
  createCustomer(input: CreateCustomerInput): Promise<Customer>;
  updateCustomer(customerId: string, input: UpdateCustomerInput): Promise<Customer>;
  softDeleteCustomer(customerId: string): Promise<void>;
  recordPaymentAtomic(input: RecordPaymentPersistenceInput): Promise<CustomerPayment>;
  listPaymentsByCustomer(customerId: string): Promise<CustomerPayment[]>;
}