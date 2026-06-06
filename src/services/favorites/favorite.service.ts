// user_favorite_restaurants table does not exist in the KDR schema.
// Favorites are not part of this schema version.
// This stub is kept to avoid import errors in legacy pages.
export const favoritesService = {
  async getAll() {
    return { data: [], count: 0 };
  },
};
