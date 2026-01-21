//middleware
// server/attachApplicantId.js
export default function createAttachApplicantId({ dbClient } = {}) {
  if (!dbClient) throw new Error('dbClient is required for attachApplicantId middleware');

  return async function attachApplicantId(req, res, next) {
    try {
      // ensure body parsing already happened (server uses bodyParser earlier)
      const explicitApplicantId =
        (req.params && req.params.applicantId) ||
        (req.params && req.params.id) ||
        (req.body && req.body.applicantId) ||
        (req.query && req.query.applicantId) ||
        (req.headers && req.headers['x-applicant-id']) ||
        null;

      // normalize explicit id
      const normalizedExplicitId = explicitApplicantId ? String(explicitApplicantId).trim() : null;
      req.explicitApplicantId = normalizedExplicitId;

      // ensure req.user exist (requireAuth typically sets it)
      const user = req.user || {};
      // compute isAdmin flag if not present
      user.isAdmin = !!(user.role && String(user.role).toLowerCase() === 'admin');

      // attempt to find DB-backed applicantId for this uid (best-effort)
      user.applicantIdFromDb = null;
      if (user.uid) {
        try {
          const found = await dbClient.findApplicantIdByUid(user.uid);
          user.applicantIdFromDb = found || null;
        } catch (err) {
          console.warn('attachApplicantId: findApplicantIdByUid failed', err && (err.message || err));
          user.applicantIdFromDb = null;
        }
      }

      // normalize/store onto user and req
      user.applicantId = user.applicantIdFromDb || null;

      // decide canonical req.applicantId: prefer explicit from request if provided (client-specified),
      // otherwise fall back to DB-derived applicant id (for ownership)
      req.applicantId = normalizedExplicitId || user.applicantId || null;

      // put updated user back on req
      req.user = user;

      
      return next();
    } catch (err) {
      console.log('attachApplicantId middleware unexpected error', err && (err.stack || err));
      // set defaults but continue
      req.user = req.user || {};
      req.user.isAdmin = !!(req.user.role && String(req.user.role).toLowerCase() === 'admin');
      req.user.applicantIdFromDb = req.user.applicantIdFromDb || null;
      req.user.applicantId = req.user.applicantId || null;
      req.explicitApplicantId = null;
      req.applicantId = req.user.applicantId || null;
      return next();
    }
  };
}
