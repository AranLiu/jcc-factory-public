function isOwner(user, ownerId) {
  return Number(user?.id) === Number(ownerId);
}

function canReadAllResources(user) {
  return Boolean(user && (
    user.role === 'admin' ||
    user.permission === 'global' ||
    user.permission === 'readonly_global'
  ));
}

function canMutateAllResources(user) {
  return Boolean(user && (
    user.role === 'admin' ||
    user.permission === 'global'
  ));
}

function canReadResource(user, ownerId) {
  return canReadAllResources(user) || isOwner(user, ownerId);
}

function canMutateResource(user, ownerId) {
  return canMutateAllResources(user) || isOwner(user, ownerId);
}

module.exports = {
  canMutateAllResources,
  canMutateResource,
  canReadAllResources,
  canReadResource,
  isOwner
};
