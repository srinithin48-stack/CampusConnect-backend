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

export default authenticate;
