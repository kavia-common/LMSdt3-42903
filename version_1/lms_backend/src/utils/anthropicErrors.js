'use strict';

/**
 * Utilities for normalizing Anthropic SDK errors into safe, actionable API responses.
 * We intentionally avoid leaking secrets or raw upstream payloads.
 */

/**
 * PUBLIC_INTERFACE
 * Returns true if an error looks like an Anthropic authentication/authorization issue.
 * @param {any} err
 * @returns {boolean}
 */
function isAnthropicAuthError(err) {
  if (!err) return false;

  // Anthropic SDK commonly exposes HTTP status.
  if (err?.status === 401 || err?.status === 403) return true;

  const msg = String(err?.message || '').toLowerCase();
  if (msg.includes('invalid x-api-key')) return true;
  if (msg.includes('authentication_error')) return true;
  if (msg.includes('api key')) {
    // Keep broad but still safe; avoids false positives while catching typical key errors.
    if (msg.includes('invalid') || msg.includes('missing') || msg.includes('unauthorized')) return true;
  }

  if (err?.error?.type === 'authentication_error') return true;
  return false;
}

/**
 * PUBLIC_INTERFACE
 * Returns true if an error is likely an Anthropic rate limit or overload error.
 * @param {any} err
 * @returns {boolean}
 */
function isAnthropicRateLimitOrOverload(err) {
  if (!err) return false;
  const status = Number(err?.status);
  return status === 429 || status === 500 || status === 503;
}

/**
 * PUBLIC_INTERFACE
 * Convert an error into a safe HTTP status + JSON body for API clients.
 *
 * @param {any} err
 * @param {object} [options]
 * @param {string} [options.fallback] - Optional friendly fallback text (for chat-like endpoints)
 * @returns {{ status: number, body: any }}
 */
function toPublicAIError(err, options = {}) {
  const fallback =
    typeof options.fallback === 'string' && options.fallback.trim()
      ? options.fallback.trim()
      : undefined;

  // Missing env key (our own thrown error)
  if (err?.code === 'ANTHROPIC_API_KEY_MISSING') {
    return {
      status: 503,
      body: {
        message:
          'AI service is not configured: missing ANTHROPIC_API_KEY. Set it in the backend environment and restart the service.',
        ...(fallback ? { fallback } : {}),
        errorCode: 'ANTHROPIC_API_KEY_MISSING',
      },
    };
  }

  // Invalid key / auth
  if (isAnthropicAuthError(err)) {
    return {
      status: 503,
      body: {
        message:
          'AI service authentication failed. Verify ANTHROPIC_API_KEY is correct and that the Anthropic account has access/credits.',
        ...(fallback ? { fallback } : {}),
        errorCode: 'ANTHROPIC_AUTH_FAILED',
      },
    };
  }

  // Rate limit / overload
  if (isAnthropicRateLimitOrOverload(err)) {
    return {
      status: 503,
      body: {
        message: 'AI service is temporarily unavailable (rate limited or overloaded). Please try again shortly.',
        ...(fallback ? { fallback } : {}),
        errorCode: 'ANTHROPIC_TEMP_UNAVAILABLE',
      },
    };
  }

  // AI input validation (our own thrown error)
  if (err?.code === 'AI_INPUT_INVALID') {
    return {
      status: 400,
      body: {
        message: err?.message || 'Invalid AI request input',
        errorCode: 'AI_INPUT_INVALID',
      },
    };
  }

  // AI output issues (our own thrown error codes)
  if (err?.code === 'AI_OUTPUT_INVALID_JSON' || err?.code === 'AI_OUTPUT_INVALID_SCHEMA') {
    return {
      status: 503,
      body: {
        message: err?.message || 'AI service returned an invalid response format. Please try again.',
        errorCode: err.code,
      },
    };
  }

  return {
    status: 503,
    body: {
      message: err?.message || 'AI service error',
      ...(fallback ? { fallback } : {}),
      errorCode: 'AI_SERVICE_ERROR',
    },
  };
}

module.exports = {
  isAnthropicAuthError,
  isAnthropicRateLimitOrOverload,
  toPublicAIError,
};
