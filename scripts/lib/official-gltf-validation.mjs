import validator from 'gltf-validator';

export const GLTF_VALIDATOR_VERSION = '2.0.0-dev.3.10';

const KNOWN_VALIDATOR_LIMITATIONS = Object.freeze([
  {
    code: 'VALUE_NOT_IN_LIST',
    pointer: /^\/images\/\d+\/mimeType$/,
    message: /image\/ktx2/,
  },
  {
    code: 'IMAGE_UNRECOGNIZED_FORMAT',
    pointer: /^\/images\/\d+$/,
    message: /Image format not recognized/,
  },
]);

function isKnownLimitation(issue) {
  return KNOWN_VALIDATOR_LIMITATIONS.some((allowed) => (
    issue.code === allowed.code
    && allowed.pointer.test(issue.pointer ?? '')
    && allowed.message.test(issue.message ?? '')
  ));
}

async function runOfficialValidator(bytes, uri, { allowErrors = false } = {}) {
  const report = await validator.validateBytes(new Uint8Array(bytes), {
    uri,
    maxIssues: 1000,
  });
  if (report.validatorVersion !== GLTF_VALIDATOR_VERSION) {
    throw new Error(
      `${uri}: expected glTF Validator ${GLTF_VALIDATOR_VERSION}, `
      + `received ${report.validatorVersion ?? 'unknown'}.`,
    );
  }
  const errors = (report.issues?.messages ?? []).filter((issue) => issue.severity === 0);
  if (!allowErrors && errors.length > 0) {
    const details = errors
      .slice(0, 10)
      .map((issue) => `${issue.code} at ${issue.pointer ?? '/'}: ${issue.message}`)
      .join('\n');
    throw new Error(`${uri}: official glTF validation failed:\n${details}`);
  }
  return report;
}

function warningKey(issue) {
  return `${issue.code}\0${issue.message}`;
}

export async function officialGltfWarningBaseline(bytes, uri) {
  const report = await runOfficialValidator(bytes, uri, { allowErrors: true });
  return (report.issues?.messages ?? [])
    .filter((issue) => issue.severity === 1 && !isKnownLimitation(issue))
    .map(warningKey)
    .sort();
}

export async function validateGlbWithOfficialValidator(
  bytes,
  uri,
  { inheritedWarnings = [] } = {},
) {
  const report = await runOfficialValidator(bytes, uri);
  const issues = report.issues?.messages ?? [];
  const remainingInherited = [...inheritedWarnings];
  const blocking = issues.filter((issue) => {
    if (issue.severity !== 1 || isKnownLimitation(issue)) return false;
    const key = warningKey(issue);
    const index = remainingInherited.indexOf(key);
    if (index === -1) return true;
    remainingInherited.splice(index, 1);
    return false;
  });
  if (blocking.length > 0) {
    const details = blocking
      .slice(0, 10)
      .map((issue) => `${issue.code} at ${issue.pointer ?? '/'}: ${issue.message}`)
      .join('\n');
    throw new Error(`${uri}: official glTF validation failed:\n${details}`);
  }

  const allowedLimitations = issues.filter((issue) => (
    issue.severity === 1 && isKnownLimitation(issue)
  ));
  return {
    validatorVersion: report.validatorVersion,
    errors: 0,
    warnings: 0,
    knownKtx2Limitations: allowedLimitations.length,
    inheritedWarnings: inheritedWarnings.length - remainingInherited.length,
    inheritedWarningCodes: [...new Set(
      issues
        .filter((issue) => (
          issue.severity === 1
          && !isKnownLimitation(issue)
          && inheritedWarnings.includes(warningKey(issue))
        ))
        .map((issue) => issue.code),
    )].sort(),
    infos: issues.filter((issue) => issue.severity === 2).length,
    hints: issues.filter((issue) => issue.severity === 3).length,
    drawCalls: report.info?.drawCallCount ?? 0,
    vertices: report.info?.totalVertexCount ?? 0,
    triangles: report.info?.totalTriangleCount ?? 0,
  };
}
