import fs from 'fs';
import os from 'os';
import path from 'path';
import { TrailerFileCache } from '../../src/services/trailerFileCache';

describe('TrailerFileCache', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'bloeki-trailer-cache-'));
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await fs.promises.rm(directory, { recursive: true, force: true });
  });

  test('teilt parallele Lesevorgaenge und liefert denselben Buffer', async () => {
    const filePath = path.join(directory, 'trailer.mp4');
    await fs.promises.writeFile(filePath, Buffer.from('trailer-data'));
    const stat = await fs.promises.stat(filePath);
    const cache = new TrailerFileCache(1024);
    const readFile = jest.spyOn(fs.promises, 'readFile');

    const [first, second] = await Promise.all([cache.load(filePath, stat), cache.load(filePath, stat)]);

    expect(first?.toString()).toBe('trailer-data');
    expect(second).toBe(first);
    expect(readFile).toHaveBeenCalledTimes(1);
  });

  test('liest eine geaenderte Datei neu und verwirft den alten Stand', async () => {
    const filePath = path.join(directory, 'trailer.mp4');
    await fs.promises.writeFile(filePath, Buffer.from('alt'));
    const cache = new TrailerFileCache(1024);
    const first = await cache.load(filePath, await fs.promises.stat(filePath));

    await fs.promises.writeFile(filePath, Buffer.from('neuer-inhalt'));
    const second = await cache.load(filePath, await fs.promises.stat(filePath));

    expect(first?.toString()).toBe('alt');
    expect(second?.toString()).toBe('neuer-inhalt');
  });

  test('laedt Dateien groesser als das Limit nicht in den Speicher', async () => {
    const filePath = path.join(directory, 'trailer.mp4');
    await fs.promises.writeFile(filePath, Buffer.alloc(16));
    const cache = new TrailerFileCache(8);

    await expect(cache.load(filePath, await fs.promises.stat(filePath))).resolves.toBeNull();
  });
});
