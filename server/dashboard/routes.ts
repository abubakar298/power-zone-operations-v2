import { Router, type RequestHandler } from 'express';
import { publicUser } from '../auth/service.js';

export function dashboardRoutes(requireSession: RequestHandler) {
  const router = Router();
  router.get('/', requireSession, (req, res) => {
    res.json({ user: publicUser(req.authSession!.user), milestone: 'Authentication and application shell' });
  });
  return router;
}
