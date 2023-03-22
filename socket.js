// let users = [];

//   io.on('connection', (socket) => {
//     console.log(`⚡: ${socket.id} user just connected!`);
//     // console.log(socket);
//     socket.on('message', (data) => {
//       io.emit('messageResponse', data);
//   });

//   socket.on('typing', (data) => socket.broadcast.emit('typingResponse', data));

//   //Listens when a new user joins the server
//   socket.on('newUser', (data) => {
//     //Adds the new user to the list of users
//     users.push(data);
//     // console.log(users);
//     //Sends the list of users to the client
//     io.emit('newUserResponse', users);
//   });

//   socket.on('disconnect', () => {
//     console.log('🔥: A user disconnected');
//     //Updates the list of users when a user disconnects from the server
//     users = users.filter((user) => user.socketID !== socket.id);
//     // console.log(users);
//     //Sends the list of users to the client
//     io.emit('newUserResponse', users);
//     socket.disconnect();
//   });
// });
