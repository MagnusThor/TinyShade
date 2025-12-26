export const Buffer = {
  write(
    device: GPUDevice,
    buffer: GPUBuffer,
    data: ArrayBufferView,
    offset = 0
  ): GPUBuffer {
    device.queue.writeBuffer(
      buffer,
      offset,
      data.buffer,
      data.byteOffset,
      data.byteLength
    );
    return buffer;
  }
};