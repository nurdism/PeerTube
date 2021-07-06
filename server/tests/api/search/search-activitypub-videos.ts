/* eslint-disable @typescript-eslint/no-unused-expressions,@typescript-eslint/require-await */

import 'mocha'
import * as chai from 'chai'
import {
  addVideoChannel,
  cleanupTests,
  flushAndRunMultipleServers,
  getVideosList,
  removeVideo,
  SearchCommand,
  ServerInfo,
  setAccessTokensToServers,
  updateVideo,
  uploadVideo,
  wait
} from '../../../../shared/extra-utils'
import { waitJobs } from '../../../../shared/extra-utils/server/jobs'
import { VideoPrivacy } from '../../../../shared/models/videos'

const expect = chai.expect

describe('Test ActivityPub videos search', function () {
  let servers: ServerInfo[]
  let videoServer1UUID: string
  let videoServer2UUID: string

  let command: SearchCommand

  before(async function () {
    this.timeout(120000)

    servers = await flushAndRunMultipleServers(2)

    await setAccessTokensToServers(servers)

    {
      const res = await uploadVideo(servers[0].url, servers[0].accessToken, { name: 'video 1 on server 1' })
      videoServer1UUID = res.body.video.uuid
    }

    {
      const res = await uploadVideo(servers[1].url, servers[1].accessToken, { name: 'video 1 on server 2' })
      videoServer2UUID = res.body.video.uuid
    }

    await waitJobs(servers)

    command = servers[0].searchCommand
  })

  it('Should not find a remote video', async function () {
    {
      const search = 'http://localhost:' + servers[1].port + '/videos/watch/43'
      const body = await command.searchVideos({ search, token: servers[0].accessToken })

      expect(body.total).to.equal(0)
      expect(body.data).to.be.an('array')
      expect(body.data).to.have.lengthOf(0)
    }

    {
      // Without token
      const search = 'http://localhost:' + servers[1].port + '/videos/watch/' + videoServer2UUID
      const body = await command.searchVideos({ search })

      expect(body.total).to.equal(0)
      expect(body.data).to.be.an('array')
      expect(body.data).to.have.lengthOf(0)
    }
  })

  it('Should search a local video', async function () {
    const search = 'http://localhost:' + servers[0].port + '/videos/watch/' + videoServer1UUID
    const body = await command.searchVideos({ search })

    expect(body.total).to.equal(1)
    expect(body.data).to.be.an('array')
    expect(body.data).to.have.lengthOf(1)
    expect(body.data[0].name).to.equal('video 1 on server 1')
  })

  it('Should search a local video with an alternative URL', async function () {
    const search = 'http://localhost:' + servers[0].port + '/w/' + videoServer1UUID
    const body1 = await command.searchVideos({ search })
    const body2 = await command.searchVideos({ search, token: servers[0].accessToken })

    for (const body of [ body1, body2 ]) {
      expect(body.total).to.equal(1)
      expect(body.data).to.be.an('array')
      expect(body.data).to.have.lengthOf(1)
      expect(body.data[0].name).to.equal('video 1 on server 1')
    }
  })

  it('Should search a remote video', async function () {
    const searches = [
      'http://localhost:' + servers[1].port + '/w/' + videoServer2UUID,
      'http://localhost:' + servers[1].port + '/videos/watch/' + videoServer2UUID
    ]

    for (const search of searches) {
      const body = await command.searchVideos({ search, token: servers[0].accessToken })

      expect(body.total).to.equal(1)
      expect(body.data).to.be.an('array')
      expect(body.data).to.have.lengthOf(1)
      expect(body.data[0].name).to.equal('video 1 on server 2')
    }
  })

  it('Should not list this remote video', async function () {
    const res = await getVideosList(servers[0].url)
    expect(res.body.total).to.equal(1)
    expect(res.body.data).to.have.lengthOf(1)
    expect(res.body.data[0].name).to.equal('video 1 on server 1')
  })

  it('Should update video of server 2, and refresh it on server 1', async function () {
    this.timeout(120000)

    const channelAttributes = {
      name: 'super_channel',
      displayName: 'super channel'
    }
    const resChannel = await addVideoChannel(servers[1].url, servers[1].accessToken, channelAttributes)
    const videoChannelId = resChannel.body.videoChannel.id

    const attributes = {
      name: 'updated',
      tag: [ 'tag1', 'tag2' ],
      privacy: VideoPrivacy.UNLISTED,
      channelId: videoChannelId
    }
    await updateVideo(servers[1].url, servers[1].accessToken, videoServer2UUID, attributes)

    await waitJobs(servers)
    // Expire video
    await wait(10000)

    // Will run refresh async
    const search = 'http://localhost:' + servers[1].port + '/videos/watch/' + videoServer2UUID
    await command.searchVideos({ search, token: servers[0].accessToken })

    // Wait refresh
    await wait(5000)

    const body = await command.searchVideos({ search, token: servers[0].accessToken })
    expect(body.total).to.equal(1)
    expect(body.data).to.have.lengthOf(1)

    const video = body.data[0]
    expect(video.name).to.equal('updated')
    expect(video.channel.name).to.equal('super_channel')
    expect(video.privacy.id).to.equal(VideoPrivacy.UNLISTED)
  })

  it('Should delete video of server 2, and delete it on server 1', async function () {
    this.timeout(120000)

    await removeVideo(servers[1].url, servers[1].accessToken, videoServer2UUID)

    await waitJobs(servers)
    // Expire video
    await wait(10000)

    // Will run refresh async
    const search = 'http://localhost:' + servers[1].port + '/videos/watch/' + videoServer2UUID
    await command.searchVideos({ search, token: servers[0].accessToken })

    // Wait refresh
    await wait(5000)

    const body = await command.searchVideos({ search, token: servers[0].accessToken })
    expect(body.total).to.equal(0)
    expect(body.data).to.have.lengthOf(0)
  })

  after(async function () {
    await cleanupTests(servers)
  })
})
