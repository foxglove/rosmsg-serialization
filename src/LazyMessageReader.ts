import { RosMsgDefinition } from "@foxglove/rosmsg";

import buildReader from "./buildReader";

function isBigEndian() {
  const array = new Uint8Array(4);
  const view = new Uint32Array(array.buffer);
  view[0] = 1;
  return array[3] === 1;
}

// Our fast handling of typed arrays requires that the user be using little endian mode since
// the browser makes typed arrays use the architecture endianness and ROS messages are little endian
const isLittleEndian = !isBigEndian();
if (!isLittleEndian) {
  throw new Error("Only Little Endian architectures are supported");
}

type LazyMessage<T> = T & { toJSON: () => T };

export class LazyMessageReader<T = unknown> {
  readerImpl: ReturnType<typeof buildReader>;
  definitions: RosMsgDefinition[];

  constructor(definitions: RosMsgDefinition[]) {
    this.readerImpl = buildReader(definitions);
    this.definitions = definitions;
  }

  // Return the size of our message within the buffer
  size(buffer: ArrayBufferView): number {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    return this.readerImpl.size(view);
  }

  source(): string {
    return this.readerImpl.source();
  }

  // Create a LazyMessage for the buffer
  // We template on R here for call site type information if the class type information T is not
  // known or available
  readMessage<R = T>(buffer: ArrayBufferView): LazyMessage<R> {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    return this.readerImpl.build(view) as LazyMessage<R>;
  }
}
