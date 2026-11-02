#!/usr/bin/env node
// Executable Codex stand-in for crash recovery tests. Never calls a model.
import { createInterface } from 'node:readline';
createInterface({ input: process.stdin }).on('line', () => {});
