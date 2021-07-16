"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.genetateScript = void 0;
function genetateScript(type, filePath, functionName) {
    if (type === 'dynamic') {
        return ` 
            const {parentPort} = require('worker_threads');
        
            parentPort.on('message', async (args) => {
                // Require and call the function for this specific task
                var response = {'type': 'success', 'value': undefined};
                try {
                    response.value = require(args.filePath)[args.functionName](...args.params);
            
                    // If the result is a Promise resolve it
                    if ( Promise.resolve(response.value) == response.value) {
                        try{
                            response.value = await response.value;
                        } catch(error){
                            response.type = 'error';
                            response.value = error;
                        }
                    }
                } catch (error) {
                    response.type = 'error';
                    response.value = error;
                }
            
                // Send the results back
                parentPort.postMessage(response);
            });
        `;
    }
    else if (type === 'static') {
        return ` 
        const {parentPort} = require('worker_threads');
        const processingFunction = require("${filePath}")["${functionName}"];

        parentPort.on('message', async (args) => {
            // Require and call the function for this specific task
            var response = {'type': 'success', 'value': undefined};
            try {
                response.value = processingFunction(...args.params);
        
                // If the result is a Promise resolve it
                if ( Promise.resolve(response.value) == response.value) {
                    try{
                        response.value = await response.value;
                    } catch(error){
                        response.type = 'error';
                        response.value = error;
                    }
                }
            } catch (error) {
                response.type = 'error';
                response.value = error;
            }

            // Send the results back
            parentPort.postMessage(response);
        });
    `;
    }
}
exports.genetateScript = genetateScript;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiU2NyaXB0R2VuZXJhdG9yLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vbGliL1NjcmlwdEdlbmVyYXRvci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxTQUFnQixjQUFjLENBQUMsSUFBSSxFQUFFLFFBQVEsRUFBRSxZQUFZO0lBQ3ZELElBQUksSUFBSSxLQUFLLFNBQVMsRUFBRTtRQUNwQixPQUFPOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztTQTBCTixDQUFBO0tBQ0o7U0FBTSxJQUFJLElBQUksS0FBSyxRQUFRLEVBQUU7UUFDMUIsT0FBTzs7OENBRStCLFFBQVEsT0FBTyxZQUFZOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0tBeUJwRSxDQUFBO0tBQ0E7QUFDTCxDQUFDO0FBM0RELHdDQTJEQyIsInNvdXJjZXNDb250ZW50IjpbImV4cG9ydCBmdW5jdGlvbiBnZW5ldGF0ZVNjcmlwdCh0eXBlLCBmaWxlUGF0aCwgZnVuY3Rpb25OYW1lKSB7XG4gICAgaWYgKHR5cGUgPT09ICdkeW5hbWljJykge1xuICAgICAgICByZXR1cm4gYCBcbiAgICAgICAgICAgIGNvbnN0IHtwYXJlbnRQb3J0fSA9IHJlcXVpcmUoJ3dvcmtlcl90aHJlYWRzJyk7XG4gICAgICAgIFxuICAgICAgICAgICAgcGFyZW50UG9ydC5vbignbWVzc2FnZScsIGFzeW5jIChhcmdzKSA9PiB7XG4gICAgICAgICAgICAgICAgLy8gUmVxdWlyZSBhbmQgY2FsbCB0aGUgZnVuY3Rpb24gZm9yIHRoaXMgc3BlY2lmaWMgdGFza1xuICAgICAgICAgICAgICAgIHZhciByZXNwb25zZSA9IHsndHlwZSc6ICdzdWNjZXNzJywgJ3ZhbHVlJzogdW5kZWZpbmVkfTtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICByZXNwb25zZS52YWx1ZSA9IHJlcXVpcmUoYXJncy5maWxlUGF0aClbYXJncy5mdW5jdGlvbk5hbWVdKC4uLmFyZ3MucGFyYW1zKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICAvLyBJZiB0aGUgcmVzdWx0IGlzIGEgUHJvbWlzZSByZXNvbHZlIGl0XG4gICAgICAgICAgICAgICAgICAgIGlmICggUHJvbWlzZS5yZXNvbHZlKHJlc3BvbnNlLnZhbHVlKSA9PSByZXNwb25zZS52YWx1ZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgdHJ5e1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlc3BvbnNlLnZhbHVlID0gYXdhaXQgcmVzcG9uc2UudmFsdWU7XG4gICAgICAgICAgICAgICAgICAgICAgICB9IGNhdGNoKGVycm9yKXtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXNwb25zZS50eXBlID0gJ2Vycm9yJztcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXNwb25zZS52YWx1ZSA9IGVycm9yO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICAgICAgcmVzcG9uc2UudHlwZSA9ICdlcnJvcic7XG4gICAgICAgICAgICAgICAgICAgIHJlc3BvbnNlLnZhbHVlID0gZXJyb3I7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgLy8gU2VuZCB0aGUgcmVzdWx0cyBiYWNrXG4gICAgICAgICAgICAgICAgcGFyZW50UG9ydC5wb3N0TWVzc2FnZShyZXNwb25zZSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgYFxuICAgIH0gZWxzZSBpZiAodHlwZSA9PT0gJ3N0YXRpYycpIHtcbiAgICAgICAgcmV0dXJuIGAgXG4gICAgICAgIGNvbnN0IHtwYXJlbnRQb3J0fSA9IHJlcXVpcmUoJ3dvcmtlcl90aHJlYWRzJyk7XG4gICAgICAgIGNvbnN0IHByb2Nlc3NpbmdGdW5jdGlvbiA9IHJlcXVpcmUoXCIke2ZpbGVQYXRofVwiKVtcIiR7ZnVuY3Rpb25OYW1lfVwiXTtcblxuICAgICAgICBwYXJlbnRQb3J0Lm9uKCdtZXNzYWdlJywgYXN5bmMgKGFyZ3MpID0+IHtcbiAgICAgICAgICAgIC8vIFJlcXVpcmUgYW5kIGNhbGwgdGhlIGZ1bmN0aW9uIGZvciB0aGlzIHNwZWNpZmljIHRhc2tcbiAgICAgICAgICAgIHZhciByZXNwb25zZSA9IHsndHlwZSc6ICdzdWNjZXNzJywgJ3ZhbHVlJzogdW5kZWZpbmVkfTtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgcmVzcG9uc2UudmFsdWUgPSBwcm9jZXNzaW5nRnVuY3Rpb24oLi4uYXJncy5wYXJhbXMpO1xuICAgICAgICBcbiAgICAgICAgICAgICAgICAvLyBJZiB0aGUgcmVzdWx0IGlzIGEgUHJvbWlzZSByZXNvbHZlIGl0XG4gICAgICAgICAgICAgICAgaWYgKCBQcm9taXNlLnJlc29sdmUocmVzcG9uc2UudmFsdWUpID09IHJlc3BvbnNlLnZhbHVlKSB7XG4gICAgICAgICAgICAgICAgICAgIHRyeXtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlc3BvbnNlLnZhbHVlID0gYXdhaXQgcmVzcG9uc2UudmFsdWU7XG4gICAgICAgICAgICAgICAgICAgIH0gY2F0Y2goZXJyb3Ipe1xuICAgICAgICAgICAgICAgICAgICAgICAgcmVzcG9uc2UudHlwZSA9ICdlcnJvcic7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXNwb25zZS52YWx1ZSA9IGVycm9yO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICByZXNwb25zZS50eXBlID0gJ2Vycm9yJztcbiAgICAgICAgICAgICAgICByZXNwb25zZS52YWx1ZSA9IGVycm9yO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBTZW5kIHRoZSByZXN1bHRzIGJhY2tcbiAgICAgICAgICAgIHBhcmVudFBvcnQucG9zdE1lc3NhZ2UocmVzcG9uc2UpO1xuICAgICAgICB9KTtcbiAgICBgXG4gICAgfVxufVxuIl19