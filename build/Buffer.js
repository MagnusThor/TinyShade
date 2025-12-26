"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Buffer = void 0;
exports.Buffer = {
    write(device, buffer, data, offset = 0) {
        device.queue.writeBuffer(buffer, offset, data.buffer, data.byteOffset, data.byteLength);
        return buffer;
    }
};
