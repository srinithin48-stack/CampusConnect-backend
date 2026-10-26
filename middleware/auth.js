import jwt from 'jsonwebtoken';

const createHttpError = (status, message) => Object.assign(new Error(message), { status });

export const authenticate = (request, response, next) => {
  const authHeader = request.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(createHttpError(401, 'Authentication token is required.'));
  }

  jwt.verify(token, process.env.JWT_SECRET, (error, payload) => {
    if (error) return next(createHttpError(401, 'Invalid or expired authentication token.'));

    request.user = { userId: payload.userId, tenantId: payload.tenantId, role: payload.role };
    next();
  });
};

// Must run after `authenticate`, which populates `request.user`.
export const requireRole = (...allowedRoles) => (request, response, next) => {
  if (!request.user || !allowedRoles.includes(request.user.role)) {
    return next(createHttpError(403, 'You do not have permission to access this resource.'));
  }
  next();
};

export const requireAdmin = requireRole('admin');

export default authenticate;
