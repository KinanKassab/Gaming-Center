/**
 * Organization-level customer master data.
 * Customers are not authentication accounts. No login, wallet, loyalty, or cards.
 */
export {
  createCustomer,
  createCustomerInputSchema,
  updateCustomer,
  updateCustomerInputSchema,
  listCustomers,
  listCustomerPage,
  listCustomersInputSchema,
  getCustomer,
  archiveCustomer,
  CUSTOMER_STATUSES,
  CUSTOMER_PAGE_SIZE,
  MAX_CUSTOMER_OFFSET,
  type CreateCustomerInput,
  type UpdateCustomerInput,
  type ListCustomersInput,
  type CustomerPage,
  type CustomerDuplicateWarning,
  type CustomerRecord,
  type CustomerWriteResult,
  type CustomerStatus,
} from "./customers";

export { normalizeEmail, normalizePhone } from "./normalize";
