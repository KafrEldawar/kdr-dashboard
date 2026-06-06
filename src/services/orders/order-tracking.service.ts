// order_tracking table does not exist in the KDR schema.
// Orders are tracked via the orders.status field (enum: pending → preparing → out_for_delivery → delivered | cancelled).
// This stub is kept to avoid import errors in legacy pages.
export const orderTrackingService = {
  async getAll() {
    return { data: [], count: 0 };
  },
};
