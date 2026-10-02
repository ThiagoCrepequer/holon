process.stderr.write(
  "Deploy independente bloqueado. Use pnpm run deploy na raiz e siga docs/operations/guarded-deployment.md. Bootstrap inicial exige procedimento excepcional autorizado.\n",
);
process.exitCode = 1;
