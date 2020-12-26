# workers-pool

The `workers-pool` package allows you to easily create a pool of workers, pass them
some heavy tasks in the form of functions, and use them as if they were asynchronous Promise-based functions.

**Important note 1:** This is not yet stable, you may not use it for production!  
**Important note 2:** Currently there is supports for only node environment!

## Installing the package
```js
npm i workers-pool
```

## Usage
### Method 1: Creating an asynchronous function

folder structure:

|__ index.js  
|__ funcs.js  
|__ asyncFuncs.js  

The reason the code is distributed into separate files in not to make circular dependency. If the path of the same file that `getAsyncFunc()` is called from is passed to it, an infinite loop will occur, since theworker thread will include this file and create another pool and worker thread and so on. However, it is possible to have the code that is in /asyncFuncs.js in /index.js. I just prefered to have them separate for organisational purposes.


/funcs.js will contain the function to be used as the task. The function doesn't have to be stringifyable, but it has to be exported and its parameters have to be stringifyable. On the other hand if the function has a call to another function, the other function also has to be exported.

```js
// funcs.js
module.exports.add = function (a, b) {
    return a + b;
}
```

In /asyncFuncs.js we pass the absolute path of the file containing the function as well as its name
to `getAsyncFunc()` to create a Promis-based Asynchronous version of it.
```js
// asyncFuncs.js
const path = require('path');
const Pool = require('workers-pool');
const pool = new Pool();

module.exports.addAsync = pool.getAsyncFunc(path.join(__dirname, 'funcs.js'), 'add');
```

Finally, in /index.js the generated function can be called with the parameters 
just like its synchronous origin.
```js
// index.js
const {addAsync} = require('./asyncFuncs');

addAsync(2, 5)
.then((result)=>{
    console.log(result) // output: 7
}).catch(err => {
    console.log(error);
});
```

### Method 2: Executing a function on the fly
Another way to run functions on the fly is also available: 

folder structure:

|__ index.js  
|__ funcs.js  

```js
// funcs.js
module.exports.add = function (a, b) {
    return a + b;
}
```

```js
// index.js
const path = require('path');
const Pool = require('workers-pool');
const pool = new Pool(5);

pool.enqueueTask(path.join(__dirname, 'funcs.js'), 'add', [2, 5], function (result){
    console.log(result) // output: 7
}, function (error) {
    // Handle error
    console.log(error);
});
```
The first step is the same. We'd also skip over the second step and
jump directly to the third step, but instead of calling `run` method
on TaskHandler object, we'd directly enqueue the function using 
`pool.enqueueTask` method of pool class.

### Getting stats
You can also get the status of the pools:
```js
const Pool = require('workers-pool');

Pool.status();     // brief info about the pools
Pool.status(true); // Verbose info about the pools
```