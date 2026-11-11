// Signature « ad hoc » de l'application Mac (sans compte Apple Developer).
// Sans elle, macOS (Apple Silicon) affiche « Colveto est endommagé » ; avec,
// il propose « Ouvrir quand même » dans Réglages → Confidentialité et sécurité.
// À remplacer par une vraie signature Developer ID + notarisation si un jour
// le projet dispose d'un compte Apple Developer.
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  // Attributs étendus (Finder, iCloud…) : refusés par codesign.
  execFileSync('xattr', ['-cr', appPath]);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
};
