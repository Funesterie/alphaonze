'use strict';

const {
  getFamilyAdminEmails,
} = require('../config/family-accounts.cjs');

const DEFAULT_FULL_ACCESS_EMAILS = [
  ...getFamilyAdminEmails(),
  'cjcarme38@yahoo.fr',
  'valerie.atek@gmail.com',
  'k.quinquinet@hseb-dresden.de',
];

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function splitEmailList(value) {
  return String(value || '')
    .split(/[,\s;]+/g)
    .map(normalizeEmail)
    .filter(Boolean);
}

function getFullAccessEmails(env = process.env) {
  const configured = [
    ...splitEmailList(env.A11_FULL_ACCESS_EMAILS),
    ...splitEmailList(env.A11_FREE_FULL_ACCESS_EMAILS),
  ];
  const emails = configured.length > 0 ? configured : DEFAULT_FULL_ACCESS_EMAILS;
  return [...new Set(emails.map(normalizeEmail).filter(Boolean))];
}

function isFullAccessEmail(value, env = process.env) {
  const email = normalizeEmail(value);
  if (!email) return false;
  return getFullAccessEmails(env).includes(email);
}

function hasFullAccess(user, env = process.env) {
  const role = String(user?.role || '').trim().toLowerCase();
  return role === 'admin'
    || user?.fullAccess === true
    || user?.full_access === true
    || isFullAccessEmail(user?.email, env);
}

module.exports = {
  DEFAULT_FULL_ACCESS_EMAILS,
  normalizeEmail,
  getFullAccessEmails,
  isFullAccessEmail,
  hasFullAccess,
};
