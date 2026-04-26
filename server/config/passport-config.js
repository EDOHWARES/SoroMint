const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const GitHubStrategy = require('passport-github2').Strategy;
const User = require('../models/User');
const { getEnv } = require('./env-config');
const { logger } = require('../utils/logger');

/**
 * @notice Initializes Passport strategies
 */
const initPassport = () => {
  const env = getEnv();

  // Serialize user for session (only needed during OAuth flow)
  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id, done) => {
    try {
      const user = await User.findById(id);
      done(null, user);
    } catch (err) {
      done(err, null);
    }
  });

  // Google Strategy
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    passport.use(new GoogleStrategy({
      clientID: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      callbackURL: `${env.AUTH_CALLBACK_URL}/api/auth/google/callback`,
      passReqToCallback: true
    }, async (req, accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails[0].value;
        const googleId = profile.id;

        // Check if user is already logged in (linking scenario)
        if (req.user) {
          const user = req.user;
          user.googleId = googleId;
          if (!user.email) user.email = email;
          if (!user.avatarUrl) user.avatarUrl = profile.photos[0]?.value;
          await user.save();
          return done(null, user);
        }

        // Check if user exists by googleId
        let user = await User.findOne({ googleId });
        if (user) return done(null, user);

        // Check if user exists by email
        user = await User.findOne({ email });
        if (user) {
          user.googleId = googleId;
          if (!user.avatarUrl) user.avatarUrl = profile.photos[0]?.value;
          await user.save();
          return done(null, user);
        }

        // Create new user
        user = new User({
          googleId,
          email,
          username: profile.displayName,
          avatarUrl: profile.photos[0]?.value,
          status: 'active'
        });
        await user.save();
        done(null, user);
      } catch (err) {
        logger.error('Google Auth Strategy Error', { error: err.message });
        done(err, null);
      }
    }));
  }

  // GitHub Strategy
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
    passport.use(new GitHubStrategy({
      clientID: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
      callbackURL: `${env.AUTH_CALLBACK_URL}/api/auth/github/callback`,
      passReqToCallback: true
    }, async (req, accessToken, refreshToken, profile, done) => {
      try {
        const githubId = profile.id;
        const email = profile.emails?.[0]?.value; // GitHub emails can be private

        // Check if user is already logged in
        if (req.user) {
          const user = req.user;
          user.githubId = githubId;
          if (!user.email && email) user.email = email;
          if (!user.avatarUrl) user.avatarUrl = profile.photos[0]?.value;
          await user.save();
          return done(null, user);
        }

        // Check if user exists by githubId
        let user = await User.findOne({ githubId });
        if (user) return done(null, user);

        // Check if email exists
        if (email) {
          user = await User.findOne({ email });
          if (user) {
            user.githubId = githubId;
            if (!user.avatarUrl) user.avatarUrl = profile.photos[0]?.value;
            await user.save();
            return done(null, user);
          }
        }

        // Create new user
        user = new User({
          githubId,
          email,
          username: profile.username || profile.displayName,
          avatarUrl: profile.photos[0]?.value,
          status: 'active'
        });
        await user.save();
        done(null, user);
      } catch (err) {
        logger.error('GitHub Auth Strategy Error', { error: err.message });
        done(err, null);
      }
    }));
  }
};

module.exports = { initPassport };
